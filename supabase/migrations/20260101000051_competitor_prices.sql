-- Competitor price tracking, phase 1 (owner only).
--
-- The owner pastes links to the same product on other shops' websites. The
-- check-competitor-prices edge function reads the price where the site allows
-- it (once a day, plus when a link is added or "check now" is pressed); where it
-- does not, the link is `manual` and the owner types the price.
--
--   competitor_links         one row per (product, shop page)
--   competitor_price_points  a reading, stored only when something changed
--   product_margin_floors    optional per-product minimum margin (owner only)
--   owner_settings.competitor_min_margin_percent   store-wide minimum margin
--
-- Everything here is owner only. Cashiers get no grant on anything (and the RLS
-- policies refuse them as well). The edge function writes with the service role.
-- Nothing is added to products_cashier_view.
--
-- Also here:
--   competitor_price_overview()     one row per link of every product that has
--                                   links, with the latest reading of the link
--   apply_competitor_price_suggestions(jsonb)
--                                   changes several selling prices as ONE
--                                   undoable batch (price_change_batches, so the
--                                   existing undo_price_change_batch reverts it)
--   schedule_competitor_check()     (re)creates the daily pg_cron job; see the
--                                   one-time setup at the end of this file.

-------------------------------------------------------------------------------
-- 1. owner-only settings
-------------------------------------------------------------------------------
alter table public.owner_settings
  add column competitor_min_margin_percent numeric(5,2) not null default 15
    check (competitor_min_margin_percent between 0 and 95);
grant update (competitor_min_margin_percent) on public.owner_settings to authenticated;

create table public.product_margin_floors (
  product_id         uuid primary key references public.products (id) on delete cascade,
  min_margin_percent numeric(5,2) not null check (min_margin_percent between 0 and 95)
);

-------------------------------------------------------------------------------
-- 2. links and price points
-------------------------------------------------------------------------------
create table public.competitor_links (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references public.products (id) on delete cascade,
  shop_name           text not null check (char_length(btrim(shop_name)) between 1 and 60),
  url                 text not null check (url ~ '^https://[^[:space:]]+$' and char_length(url) <= 2000),
  -- auto: the function reads the page. manual: the owner types the price.
  mode                text not null default 'auto' check (mode in ('auto', 'manual')),
  last_status         text check (last_status in ('ok', 'refused', 'unsupported', 'error', 'manual')),
  last_status_detail  text check (char_length(last_status_detail) <= 300),
  -- Last attempt of any kind (shows how fresh the screen is).
  last_checked_at     timestamptz,
  -- Last time a price was actually read or typed. A refused or failed attempt
  -- does NOT move it, so an old price never looks fresh. The 7-day rule of the
  -- pricing decision uses this.
  last_ok_at          timestamptz,
  -- Last time the edge function fetched the site (daily job or the owner's "check
  -- now"): the job skips links fetched in the last 20 h, "check now" waits 10 minutes.
  last_auto_check_at  timestamptz,
  created_by          uuid default auth.uid() references public.profiles (id),
  created_at          timestamptz not null default now(),
  unique (product_id, url)
);
create index idx_competitor_links_product on public.competitor_links (product_id);

create table public.competitor_price_points (
  id                  uuid primary key default gen_random_uuid(),
  link_id             uuid not null references public.competitor_links (id) on delete cascade,
  -- Null when the shop shows no usable price (e.g. out of stock without a price).
  price_cents         bigint check (price_cents > 0),
  regular_price_cents bigint check (regular_price_cents > 0),
  on_sale             boolean not null default false,
  in_stock            boolean not null default true,
  low_stock_remaining integer check (low_stock_remaining >= 0),
  title               text check (char_length(title) <= 300),
  -- A URL only. The app displays it; nothing is downloaded or re-hosted.
  image_url           text check (char_length(image_url) <= 2000),
  source              text not null check (source in ('auto', 'manual')),
  observed_at         timestamptz not null default now(),
  entered_by          uuid references public.profiles (id)
);
create index idx_competitor_points_link on public.competitor_price_points (link_id, observed_at desc);

-------------------------------------------------------------------------------
-- 3. RLS and grants: owner only
-------------------------------------------------------------------------------
alter table public.product_margin_floors enable row level security;
alter table public.competitor_links enable row level security;
alter table public.competitor_price_points enable row level security;

create policy "owner manages margin floors" on public.product_margin_floors
  for all using (public.is_owner()) with check (public.is_owner());
create policy "owner manages competitor links" on public.competitor_links
  for all using (public.is_owner()) with check (public.is_owner());
create policy "owner manages competitor price points" on public.competitor_price_points
  for all using (public.is_owner()) with check (public.is_owner());

-- Tables are not auto-granted to `authenticated` on recently created hosted
-- projects, so the grants are explicit. RLS above is what limits them to the
-- owner. Nothing for anon.
revoke all on public.product_margin_floors, public.competitor_links, public.competitor_price_points
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.product_margin_floors, public.competitor_links, public.competitor_price_points
  to authenticated;
-- The edge function (service role) reads the links and writes readings.
grant select, update on public.competitor_links to service_role;
grant select, insert on public.competitor_price_points to service_role;

-------------------------------------------------------------------------------
-- 4. overview: one row per link, latest reading of each link
-------------------------------------------------------------------------------
-- p_product_id null: every active product with links. Given: that product only
-- (even inactive), for its edit screen.
create function public.competitor_price_overview(p_product_id uuid default null)
returns table (
  product_id           uuid,
  product_name         text,
  unit                 public.product_unit,
  selling_price_cents  bigint,
  cost_cents           bigint,
  min_margin_percent   numeric,
  margin_override      numeric,
  link_id              uuid,
  shop_name            text,
  url                  text,
  mode                 text,
  last_status          text,
  last_status_detail   text,
  last_checked_at      timestamptz,
  last_ok_at           timestamptz,
  price_cents          bigint,
  regular_price_cents  bigint,
  on_sale              boolean,
  in_stock             boolean,
  low_stock_remaining  integer,
  title                text,
  image_url            text,
  observed_at          timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'only the owner can read competitor prices' using errcode = '42501';
  end if;

  return query
  select p.id, p.name, p.unit, p.selling_price_cents, p.current_cost_cents,
         coalesce(f.min_margin_percent, s.competitor_min_margin_percent),
         f.min_margin_percent,
         l.id, l.shop_name, l.url, l.mode, l.last_status, l.last_status_detail,
         l.last_checked_at, l.last_ok_at,
         pt.price_cents, pt.regular_price_cents, pt.on_sale, pt.in_stock,
         pt.low_stock_remaining, pt.title, pt.image_url, pt.observed_at
  from public.competitor_links l
  join public.products p on p.id = l.product_id
  cross join (select competitor_min_margin_percent from public.owner_settings where singleton) s
  left join public.product_margin_floors f on f.product_id = p.id
  left join lateral (
    select x.price_cents, x.regular_price_cents, x.on_sale, x.in_stock,
           x.low_stock_remaining, x.title, x.image_url, x.observed_at
    from public.competitor_price_points x
    where x.link_id = l.id
    order by x.observed_at desc, x.id desc
    limit 1
  ) pt on true
  where case when p_product_id is null then p.active else p.id = p_product_id end
  order by p.name, l.created_at;
end;
$$;

revoke execute on function public.competitor_price_overview(uuid) from public, anon;
grant execute on function public.competitor_price_overview(uuid) to authenticated;

-------------------------------------------------------------------------------
-- 5. apply suggested prices as one undoable batch
-------------------------------------------------------------------------------
-- The batch tables belong to migration 045 (percent changes). A batch made here
-- has source 'competitor' (percent 0, no category) and is reverted by the same
-- undo_price_change_batch, which only restores products still at the price the
-- batch gave them. The price itself changes through UPDATE products, so the
-- existing triggers record selling_price_history and bump updated_at.
alter table public.price_change_batches
  add column source text not null default 'percent' check (source in ('percent', 'competitor'));

-- p_items: [{ "product_id": uuid, "selling_price_cents": bigint }, ...]
-- Returns { "batch_id": uuid | null, "changed": n }; no batch when nothing moved.
create function public.apply_competitor_price_suggestions(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
  v_changed integer;
begin
  if not public.is_owner() then
    raise exception 'only the owner can change prices' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'no prices to apply' using errcode = '22023';
  end if;

  if exists (
       select 1 from jsonb_to_recordset(p_items) as a(product_id uuid, selling_price_cents bigint)
       where a.product_id is null or a.selling_price_cents is null or a.selling_price_cents <= 0)
     or (select count(*) from jsonb_array_elements(p_items))
        <> (select count(distinct a.product_id)
            from jsonb_to_recordset(p_items) as a(product_id uuid, selling_price_cents bigint)) then
    raise exception 'invalid prices' using errcode = '22023';
  end if;

  insert into public.price_change_batches (category_id, percent, source)
  values (null, 0, 'competitor')
  returning id into v_batch;

  with target as (
    select p.id, p.selling_price_cents as old_cents, a.selling_price_cents as new_cents
    from public.products p
    join jsonb_to_recordset(p_items) as a(product_id uuid, selling_price_cents bigint)
      on a.product_id = p.id
    where p.active
    for update of p
  ),
  upd as (
    update public.products p
    set selling_price_cents = t.new_cents
    from target t
    where p.id = t.id and t.new_cents <> t.old_cents
    returning p.id, t.old_cents, t.new_cents
  ),
  ins as (
    insert into public.price_change_items (batch_id, product_id, old_price_cents, new_price_cents)
    select v_batch, id, old_cents, new_cents from upd
    returning 1
  )
  select count(*) into v_changed from ins;

  if v_changed = 0 then
    delete from public.price_change_batches where id = v_batch;
    return jsonb_build_object('batch_id', null, 'changed', 0);
  end if;

  update public.price_change_batches set product_count = v_changed where id = v_batch;
  insert into public.activity_log (actor_id, action, entity_id, details)
  values (auth.uid(), 'competitor_price_apply', v_batch, jsonb_build_object('product_count', v_changed));
  return jsonb_build_object('batch_id', v_batch, 'changed', v_changed);
end;
$$;

revoke execute on function public.apply_competitor_price_suggestions(jsonb) from public, anon;
grant execute on function public.apply_competitor_price_suggestions(jsonb) to authenticated;

-------------------------------------------------------------------------------
-- 6. daily schedule (pg_cron + pg_net + vault)
-------------------------------------------------------------------------------
-- ONE-TIME SETUP (SQL editor of the hosted project, once):
--   1. choose a long random string and store it twice:
--        select vault.create_secret('<random>', 'competitor_check_secret');
--        select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/check-competitor-prices',
--                                   'competitor_check_url');
--      and give the edge function the same value:
--        supabase secrets set COMPETITOR_CHECK_SECRET=<random>
--   2. select public.schedule_competitor_check();
-- It runs every day at 05:00 UTC = 06:00 in Morocco (UTC+1; during Ramadan
-- Morocco is on UTC+0 and the job then runs at 05:00 local, which is harmless).
-- The job sends the secret in the x-cron-secret header; the function refuses any
-- call without it. Re-running schedule_competitor_check() replaces the job.
create function public.schedule_competitor_check()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_command constant text := $cmd$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'competitor_check_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'competitor_check_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cmd$;
  v_have_secrets boolean;
begin
  begin
    execute $q$select count(*) = 2 from vault.decrypted_secrets
               where name in ('competitor_check_secret', 'competitor_check_url')$q$
      into v_have_secrets;
  exception when others then
    v_have_secrets := false;
  end;
  if not coalesce(v_have_secrets, false) then
    raise notice 'competitor check not scheduled: create the vault secrets competitor_check_secret and competitor_check_url, then run select public.schedule_competitor_check();';
    return 'not_scheduled: secrets missing';
  end if;

  begin
    create extension if not exists pg_net with schema extensions;
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'check-competitor-prices';
    perform cron.schedule('check-competitor-prices', '0 5 * * *', v_command);
  exception when others then
    raise notice 'competitor check not scheduled (pg_cron/pg_net unavailable): %', sqlerrm;
    return 'not_scheduled: ' || sqlerrm;
  end;
  return 'scheduled';
end;
$$;

revoke execute on function public.schedule_competitor_check() from public, anon, authenticated;

-- On a fresh database the secrets do not exist yet: this only prints the NOTICE.
select public.schedule_competitor_check();
