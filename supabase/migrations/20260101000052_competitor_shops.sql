-- Competitor tracking, phase 2: whole competitor shops (owner only).
--
-- The owner adds a competitor shop by its URL (WooCommerce / WordPress). The
-- sync-competitor-shop edge function reads the shop's public catalogue slowly,
-- once a week (and on "Lire maintenant"), and keeps only facts. A matcher then
-- proposes "our product <-> their product" pairs by name; the owner confirms
-- (which creates a phase 1 competitor_links row plus a first price point), or
-- marks their product as wanted / ignored.
--
--   competitor_shops           one row per shop; status, resume page, lease
--   competitor_catalog_items   one row per item of a shop's catalogue
--
-- Everything is owner only (RLS through is_owner() and explicit grants; nothing
-- for anon, nothing in any cashier view). The edge functions write with the
-- service role; a shop can only be created by the function (no INSERT grant for
-- `authenticated`), so an unvalidated shop cannot exist. All the owner's
-- decisions go through the security definer functions below, which keep the
-- invariants (one product matched by at most one item per shop, a confirmed
-- match always has its link, ...).

-------------------------------------------------------------------------------
-- 1. tables
-------------------------------------------------------------------------------
create table public.competitor_shops (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (char_length(btrim(name)) between 1 and 60),
  -- The origin of the shop, https only, e.g. https://yournightshop.ma
  base_url               text not null unique
                           check (base_url ~ '^https://[^[:space:]/]+$' and char_length(base_url) <= 200),
  platform               text not null default 'woocommerce' check (platform = 'woocommerce'),
  status                 text not null default 'ok' check (status in ('ok', 'refused', 'error', 'syncing')),
  status_detail          text check (char_length(status_detail) <= 300),
  -- Moves only when a read BEGINS at page 1 (never on a resume): an item whose
  -- last_seen_at is older than this was not in the finished read, so it is gone.
  last_sync_started_at   timestamptz,
  last_sync_completed_at timestamptz,
  -- Page the next invocation continues from; null = no read in progress.
  next_page              integer check (next_page >= 1),
  total_items            integer check (total_items >= 0),
  -- Lease taken by the function so two invocations never read the same shop.
  sync_claimed_at        timestamptz,
  created_by             uuid default auth.uid() references public.profiles (id),
  created_at             timestamptz not null default now()
);

create table public.competitor_catalog_items (
  id                     uuid primary key default gen_random_uuid(),
  shop_id                uuid not null references public.competitor_shops (id) on delete cascade,
  external_id            text not null check (char_length(external_id) between 1 and 100),
  name                   text not null check (char_length(name) between 1 and 300),
  url                    text not null check (url ~ '^https://[^[:space:]]+$' and char_length(url) <= 2000),
  price_cents            bigint check (price_cents > 0),
  regular_price_cents    bigint check (regular_price_cents > 0),
  on_sale                boolean not null default false,
  in_stock               boolean not null default true,
  low_stock_remaining    integer check (low_stock_remaining >= 0),
  -- A URL only: displayed, never downloaded or re-hosted automatically.
  image_url              text check (char_length(image_url) <= 2000),
  categories             text[] not null default '{}',
  -- Position in the shop's "most popular first" order.
  popularity_rank        integer check (popularity_rank >= 1),
  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  -- Not in the last finished read: hidden, never deleted.
  gone                   boolean not null default false,
  decision               text not null default 'undecided'
                           check (decision in ('undecided', 'proposed', 'matched', 'missing', 'wanted', 'ignored')),
  candidate_product_id   uuid references public.products (id) on delete set null,
  match_score            numeric(5,4) check (match_score between 0 and 1),
  match_uncertain        boolean not null default false,
  matched_product_id     uuid references public.products (id) on delete set null,
  link_id                uuid references public.competitor_links (id) on delete set null,
  sourcing_note          text check (char_length(sourcing_note) <= 300),
  sourcing_supplier_id   uuid references public.suppliers (id) on delete set null,
  sourcing_status        text check (sourcing_status in ('to_ask', 'asked', 'found')),
  decided_at             timestamptz,
  decided_by             uuid references public.profiles (id),
  unique (shop_id, external_id)
);
create index idx_competitor_items_list
  on public.competitor_catalog_items (shop_id, decision, popularity_rank) where not gone;
create index idx_competitor_items_decision
  on public.competitor_catalog_items (decision, popularity_rank) where not gone;
create index idx_competitor_items_matched_product
  on public.competitor_catalog_items (matched_product_id) where matched_product_id is not null;
create index idx_competitor_items_link
  on public.competitor_catalog_items (link_id) where link_id is not null;
-- One of our products is matched (or proposed) by at most one item per shop.
create unique index uq_competitor_items_matched_product
  on public.competitor_catalog_items (shop_id, matched_product_id) where decision = 'matched';
create unique index uq_competitor_items_candidate_product
  on public.competitor_catalog_items (shop_id, candidate_product_id) where decision = 'proposed';

-------------------------------------------------------------------------------
-- 2. RLS and grants: owner only
-------------------------------------------------------------------------------
alter table public.competitor_shops enable row level security;
alter table public.competitor_catalog_items enable row level security;

create policy "owner reads competitor shops" on public.competitor_shops
  for select using (public.is_owner());
create policy "owner deletes competitor shops" on public.competitor_shops
  for delete using (public.is_owner());
create policy "owner reads competitor items" on public.competitor_catalog_items
  for select using (public.is_owner());

revoke all on public.competitor_shops, public.competitor_catalog_items
  from public, anon, authenticated;
-- Tables are not auto-granted on recently created hosted projects: explicit
-- grants; RLS above limits them to the owner. The owner cannot insert or update
-- directly: shops are created by the edge function, decisions go through RPCs.
grant select, delete on public.competitor_shops to authenticated;
grant select on public.competitor_catalog_items to authenticated;

-- The edge functions (service role).
grant select, insert, update, delete on public.competitor_shops to service_role;
grant select, insert, update on public.competitor_catalog_items to service_role;
-- The matcher reads our product names (id and name only).
grant select (id, name, active) on public.products to service_role;
grant select on public.competitor_links to service_role;

-------------------------------------------------------------------------------
-- 3. a deleted phase 1 link un-matches its catalogue item
-------------------------------------------------------------------------------
create function public.competitor_link_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.competitor_catalog_items
  set decision = 'missing', matched_product_id = null, link_id = null
  where link_id = old.id and decision = 'matched';
  return old;
end;
$$;
revoke execute on function public.competitor_link_deleted() from public, anon, authenticated;
create trigger trg_competitor_link_deleted
  before delete on public.competitor_links
  for each row execute function public.competitor_link_deleted();

-------------------------------------------------------------------------------
-- 4. reading: shops overview, lists, counts, categories
-------------------------------------------------------------------------------
create function public.competitor_shop_overview()
returns table (
  id uuid, name text, base_url text, status text, status_detail text,
  last_sync_started_at timestamptz, last_sync_completed_at timestamptz,
  next_page integer, total_items integer, created_at timestamptz,
  items_count bigint, proposed_count bigint, missing_count bigint,
  wanted_count bigint, matched_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'only the owner can read competitor shops' using errcode = '42501';
  end if;
  return query
  select s.id, s.name, s.base_url, s.status, s.status_detail,
         s.last_sync_started_at, s.last_sync_completed_at, s.next_page, s.total_items, s.created_at,
         count(i.id) filter (where not i.gone),
         count(i.id) filter (where not i.gone and i.decision = 'proposed'),
         count(i.id) filter (where not i.gone and i.decision in ('missing', 'undecided')),
         count(i.id) filter (where i.decision = 'wanted'),
         count(i.id) filter (where i.decision = 'matched')
  from public.competitor_shops s
  left join public.competitor_catalog_items i on i.shop_id = s.id
  group by s.id
  order by s.name;
end;
$$;
revoke execute on function public.competitor_shop_overview() from public, anon;
grant execute on function public.competitor_shop_overview() to authenticated;

-- Counts for the tab badges.
create function public.competitor_catalog_counts()
returns table (proposed bigint, missing bigint, wanted bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'only the owner can read competitor items' using errcode = '42501';
  end if;
  return query
  select count(*) filter (where i.decision = 'proposed' and not i.gone),
         count(*) filter (where i.decision in ('missing', 'undecided') and not i.gone),
         count(*) filter (where i.decision = 'wanted')
  from public.competitor_catalog_items i;
end;
$$;
revoke execute on function public.competitor_catalog_counts() from public, anon;
grant execute on function public.competitor_catalog_counts() to authenticated;

-- Their category names, for the filter of a view.
create function public.competitor_catalog_categories(p_view text, p_shop uuid default null)
returns table (category text, items bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'only the owner can read competitor items' using errcode = '42501';
  end if;
  return query
  select c, count(*)
  from public.competitor_catalog_items i, unnest(i.categories) c
  where (p_shop is null or i.shop_id = p_shop)
    and case p_view
          when 'missing' then i.decision in ('missing', 'undecided') and not i.gone
          when 'proposed' then i.decision = 'proposed' and not i.gone
          when 'wanted' then i.decision = 'wanted'
          else false end
  group by c
  order by count(*) desc, c
  limit 200;
end;
$$;
revoke execute on function public.competitor_catalog_categories(text, uuid) from public, anon;
grant execute on function public.competitor_catalog_categories(text, uuid) to authenticated;

-- One page of a view: 'proposed' (A confirmer), 'missing' (Vous ne l'avez pas),
-- 'wanted' (A sourcer). Filtering, sorting and paging happen here: a shop has
-- 1500+ items and PostgREST caps the rows of a plain select.
-- p_sort: popularity | price_asc | price_desc | newest | score | decided
create function public.competitor_catalog_page(
  p_view text,
  p_shop uuid default null,
  p_category text default null,
  p_in_stock_only boolean default false,
  p_promo_only boolean default false,
  p_sort text default 'popularity',
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid, shop_id uuid, shop_name text, name text, url text,
  price_cents bigint, regular_price_cents bigint, on_sale boolean, in_stock boolean,
  low_stock_remaining integer, image_url text, categories text[], popularity_rank integer,
  first_seen_at timestamptz, last_seen_at timestamptz, gone boolean, decision text,
  candidate_product_id uuid, candidate_product_name text, candidate_selling_price_cents bigint,
  match_score numeric, match_uncertain boolean,
  sourcing_note text, sourcing_supplier_id uuid, sourcing_supplier_name text, sourcing_status text,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'only the owner can read competitor items' using errcode = '42501';
  end if;
  if p_view not in ('proposed', 'missing', 'wanted') then
    raise exception 'unknown view' using errcode = '22023';
  end if;
  return query
  select i.id, i.shop_id, s.name, i.name, i.url,
         i.price_cents, i.regular_price_cents, i.on_sale, i.in_stock,
         i.low_stock_remaining, i.image_url, i.categories, i.popularity_rank,
         i.first_seen_at, i.last_seen_at, i.gone, i.decision,
         i.candidate_product_id, p.name, p.selling_price_cents,
         i.match_score, i.match_uncertain,
         i.sourcing_note, i.sourcing_supplier_id, sp.name, i.sourcing_status,
         count(*) over ()
  from public.competitor_catalog_items i
  join public.competitor_shops s on s.id = i.shop_id
  left join public.products p on p.id = i.candidate_product_id
  left join public.suppliers sp on sp.id = i.sourcing_supplier_id
  where (p_shop is null or i.shop_id = p_shop)
    and case p_view
          when 'missing' then i.decision in ('missing', 'undecided') and not i.gone
          when 'proposed' then i.decision = 'proposed' and not i.gone and i.candidate_product_id is not null
          else i.decision = 'wanted' end
    and (p_category is null or p_category = any (i.categories))
    and (not p_in_stock_only or i.in_stock)
    and (not p_promo_only or i.on_sale)
  order by
    case when p_sort = 'price_asc' then i.price_cents end asc nulls last,
    case when p_sort = 'price_desc' then i.price_cents end desc nulls last,
    case when p_sort = 'newest' then i.first_seen_at end desc,
    case when p_sort = 'score' then i.match_score end desc nulls last,
    case when p_sort = 'decided' then i.decided_at end desc nulls last,
    i.popularity_rank asc nulls last,
    i.id
  limit greatest(least(coalesce(p_limit, 30), 100), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke execute on function public.competitor_catalog_page(text, uuid, text, boolean, boolean, text, integer, integer)
  from public, anon;
grant execute on function public.competitor_catalog_page(text, uuid, text, boolean, boolean, text, integer, integer)
  to authenticated;

-------------------------------------------------------------------------------
-- 5. the owner's decisions
-------------------------------------------------------------------------------
-- Confirm that `item` is the same product as ours: creates (or reuses) the
-- phase 1 link and its first price point, in one transaction. The price point
-- and the link are stamped with the catalogue's last_seen_at, not now(): a
-- price read a week ago must not look fresh to the 7-day rule. Idempotent.
-- Returns the link id.
create function public.confirm_competitor_match(p_item_id uuid, p_product_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.competitor_catalog_items;
  v_shop public.competitor_shops;
  v_link uuid;
begin
  if not public.is_owner() then
    raise exception 'only the owner can confirm matches' using errcode = '42501';
  end if;
  select * into v_item from public.competitor_catalog_items where id = p_item_id for update;
  if not found then
    raise exception 'unknown catalogue item' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'unknown product' using errcode = 'P0002';
  end if;
  -- Already confirmed with this product: nothing more to do.
  if v_item.decision = 'matched' and v_item.matched_product_id = p_product_id and v_item.link_id is not null then
    return v_item.link_id;
  end if;
  if v_item.decision = 'matched' then
    raise exception 'item already matched to another product' using errcode = '23505';
  end if;
  select * into v_shop from public.competitor_shops where id = v_item.shop_id;

  -- Another item of this shop already matched to this product?
  if exists (select 1 from public.competitor_catalog_items
             where shop_id = v_item.shop_id and matched_product_id = p_product_id and id <> p_item_id
               and decision = 'matched') then
    raise exception 'product already matched in this shop' using errcode = '23505';
  end if;

  insert into public.competitor_links
    (product_id, shop_name, url, mode, last_status, last_checked_at, last_ok_at, last_auto_check_at)
  values
    (p_product_id, v_shop.name, v_item.url, 'auto', 'ok', v_item.last_seen_at, v_item.last_seen_at, v_item.last_seen_at)
  on conflict (product_id, url) do nothing
  returning id into v_link;
  if v_link is null then
    select id into v_link from public.competitor_links where product_id = p_product_id and url = v_item.url;
  end if;

  -- The first point, from the catalogue; not when the link already has history.
  if not exists (select 1 from public.competitor_price_points where link_id = v_link) then
    insert into public.competitor_price_points
      (link_id, price_cents, regular_price_cents, on_sale, in_stock, low_stock_remaining,
       title, image_url, source, observed_at)
    values
      (v_link, v_item.price_cents, v_item.regular_price_cents, v_item.on_sale, v_item.in_stock,
       v_item.low_stock_remaining, v_item.name, v_item.image_url, 'auto', v_item.last_seen_at);
  end if;

  update public.competitor_catalog_items
  set decision = 'matched', matched_product_id = p_product_id, link_id = v_link,
      candidate_product_id = null, match_score = null, match_uncertain = false,
      sourcing_status = null, sourcing_note = null, sourcing_supplier_id = null,
      decided_at = now(), decided_by = auth.uid()
  where id = p_item_id;
  return v_link;
end;
$$;
revoke execute on function public.confirm_competitor_match(uuid, uuid) from public, anon;
grant execute on function public.confirm_competitor_match(uuid, uuid) to authenticated;

-- "Pas le meme": a proposed pair is refused; the item goes to "Vous ne l'avez
-- pas" and is not proposed again (the owner decided).
create function public.reject_competitor_match(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'only the owner can reject matches' using errcode = '42501';
  end if;
  update public.competitor_catalog_items
  set decision = 'missing', candidate_product_id = null, match_score = null, match_uncertain = false,
      decided_at = now(), decided_by = auth.uid()
  where id = p_item_id and decision = 'proposed';
  if not found then
    raise exception 'item is not proposed' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.reject_competitor_match(uuid) from public, anon;
grant execute on function public.reject_competitor_match(uuid) to authenticated;

-- wanted (A sourcer) | ignored (hidden for good) | missing (back to the list).
create function public.set_competitor_item_decision(p_item_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'only the owner can decide on items' using errcode = '42501';
  end if;
  if p_decision not in ('wanted', 'ignored', 'missing') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  update public.competitor_catalog_items
  set decision = p_decision,
      candidate_product_id = null, match_score = null, match_uncertain = false,
      sourcing_status = case when p_decision = 'wanted' then coalesce(sourcing_status, 'to_ask') end,
      sourcing_note = case when p_decision = 'wanted' then sourcing_note end,
      sourcing_supplier_id = case when p_decision = 'wanted' then sourcing_supplier_id end,
      decided_at = now(), decided_by = auth.uid()
  where id = p_item_id and decision <> 'matched';
  if not found then
    raise exception 'item not found or already matched' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.set_competitor_item_decision(uuid, text) from public, anon;
grant execute on function public.set_competitor_item_decision(uuid, text) to authenticated;

-- Note, supplier and status of a wanted item.
create function public.update_competitor_sourcing(
  p_item_id uuid, p_note text, p_supplier_id uuid, p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'only the owner can edit sourcing' using errcode = '42501';
  end if;
  if p_status not in ('to_ask', 'asked', 'found') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) > 300 then
    raise exception 'note too long' using errcode = '22001';
  end if;
  update public.competitor_catalog_items
  set sourcing_note = nullif(btrim(coalesce(p_note, '')), ''),
      sourcing_supplier_id = p_supplier_id,
      sourcing_status = p_status
  where id = p_item_id and decision = 'wanted';
  if not found then
    raise exception 'item is not wanted' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.update_competitor_sourcing(uuid, text, uuid, text) from public, anon;
grant execute on function public.update_competitor_sourcing(uuid, text, uuid, text) to authenticated;

-------------------------------------------------------------------------------
-- 6. the function's writes (service role only)
-------------------------------------------------------------------------------
-- Items read from a page of the catalogue: facts only. On conflict ONLY the
-- facts, last_seen_at and gone are touched; the decision, first_seen_at, the
-- sourcing and match columns are never reset by a read.
-- p_items: [{external_id,name,url,price_cents,regular_price_cents,on_sale,in_stock,
--            low_stock_remaining,image_url,categories,popularity_rank}]
create function public.upsert_competitor_catalog_items(p_shop_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with src as (
    select * from jsonb_to_recordset(p_items) as x(
      external_id text, name text, url text, price_cents bigint, regular_price_cents bigint,
      on_sale boolean, in_stock boolean, low_stock_remaining integer, image_url text,
      categories jsonb, popularity_rank integer)
  ),
  up as (
    insert into public.competitor_catalog_items as i
      (shop_id, external_id, name, url, price_cents, regular_price_cents, on_sale, in_stock,
       low_stock_remaining, image_url, categories, popularity_rank, first_seen_at, last_seen_at, gone)
    select p_shop_id, s.external_id, s.name, s.url, s.price_cents, s.regular_price_cents,
           coalesce(s.on_sale, false), coalesce(s.in_stock, true), s.low_stock_remaining, s.image_url,
           coalesce(array(select jsonb_array_elements_text(s.categories)), '{}'),
           s.popularity_rank, now(), now(), false
    from src s
    on conflict (shop_id, external_id) do update
    set name = excluded.name, url = excluded.url,
        price_cents = excluded.price_cents, regular_price_cents = excluded.regular_price_cents,
        on_sale = excluded.on_sale, in_stock = excluded.in_stock,
        low_stock_remaining = excluded.low_stock_remaining, image_url = excluded.image_url,
        categories = excluded.categories, popularity_rank = excluded.popularity_rank,
        last_seen_at = excluded.last_seen_at, gone = false
    returning 1
  )
  select count(*) into v_count from up;
  return v_count;
end;
$$;
revoke execute on function public.upsert_competitor_catalog_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_competitor_catalog_items(uuid, jsonb) to service_role;

-- A new read begins: the start time is stamped HERE, by the database clock that
-- also stamps last_seen_at, so "not seen since the start" never compares two clocks.
create function public.start_competitor_shop_read(p_shop_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started timestamptz := clock_timestamp();
begin
  update public.competitor_shops
  set status = 'syncing', status_detail = null, next_page = 1, last_sync_started_at = v_started
  where id = p_shop_id;
  if not found then
    raise exception 'unknown shop' using errcode = 'P0002';
  end if;
  return v_started;
end;
$$;
revoke execute on function public.start_competitor_shop_read(uuid) from public, anon, authenticated;
grant execute on function public.start_competitor_shop_read(uuid) to service_role;

-- A finished read: what it did not see is gone; the shop is ok again.
create function public.finish_competitor_shop_read(p_shop_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started timestamptz;
  v_total integer;
begin
  select last_sync_started_at into v_started from public.competitor_shops where id = p_shop_id for update;
  if v_started is null then
    raise exception 'no read in progress' using errcode = 'P0002';
  end if;
  update public.competitor_catalog_items
  set gone = true
  where shop_id = p_shop_id and last_seen_at < v_started and not gone;
  select count(*) into v_total from public.competitor_catalog_items where shop_id = p_shop_id and not gone;
  update public.competitor_shops
  set status = 'ok', status_detail = null, next_page = null, total_items = v_total,
      last_sync_completed_at = now(), sync_claimed_at = null
  where id = p_shop_id;
  return v_total;
end;
$$;
revoke execute on function public.finish_competitor_shop_read(uuid) from public, anon, authenticated;
grant execute on function public.finish_competitor_shop_read(uuid) to service_role;

-- Matches computed by the function: [{item_id, product_id|null, score, uncertain}].
-- Only items nobody decided are touched (undecided; proposed or missing with no
-- decided_by). A row with a product becomes `proposed`, without one `missing`.
-- Earlier automatic proposals of the shop are reset first (p_reset, true for the
-- first chunk), so a recalculation replaces them. A product already matched in the shop is never proposed again.
create function public.apply_competitor_matches(p_shop_id uuid, p_rows jsonb, p_reset boolean default true)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- p_reset: true on the first call of a recalculation (the rows may come in chunks).
  if p_reset then
    update public.competitor_catalog_items
    set decision = 'undecided', candidate_product_id = null, match_score = null, match_uncertain = false
    where shop_id = p_shop_id and decision = 'proposed' and decided_by is null;
  end if;

  with rows as (
    select * from jsonb_to_recordset(p_rows) as r(item_id uuid, product_id uuid, score numeric, uncertain boolean)
  ),
  best as (
    -- At most one item per product (the best score).
    select r.*, row_number() over (partition by r.product_id order by r.score desc, r.item_id) as rn
    from rows r
    where r.product_id is not null
      and exists (select 1 from public.products p where p.id = r.product_id and p.active)
      and not exists (select 1 from public.competitor_catalog_items m
                      where m.shop_id = p_shop_id and m.matched_product_id = r.product_id and m.decision = 'matched')
  ),
  upd as (
    update public.competitor_catalog_items i
    set decision = case when b.product_id is not null and b.rn = 1 then 'proposed' else 'missing' end,
        candidate_product_id = case when b.rn = 1 then b.product_id end,
        match_score = case when b.rn = 1 then round(b.score, 4) end,
        match_uncertain = case when b.rn = 1 then coalesce(b.uncertain, false) else false end
    from (
      select r.item_id, b.product_id, b.score, b.uncertain, b.rn
      from rows r left join best b on b.item_id = r.item_id
    ) b
    where i.id = b.item_id and i.shop_id = p_shop_id and not i.gone
      and i.decision in ('undecided', 'missing') and i.decided_by is null
    returning 1
  )
  select count(*) into v_count from upd;
  return v_count;
end;
$$;
revoke execute on function public.apply_competitor_matches(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.apply_competitor_matches(uuid, jsonb, boolean) to service_role;

-------------------------------------------------------------------------------
-- 7. weekly schedule (pg_cron + pg_net + vault)
-------------------------------------------------------------------------------
-- ONE-TIME SETUP (SQL editor of the hosted project, once; competitor_check_secret
-- already exists from phase 1 and is reused):
--   1. select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/sync-competitor-shop',
--                                 'competitor_sync_url');
--      (the function reads the same COMPETITOR_CHECK_SECRET function secret as
--       check-competitor-prices)
--   2. select public.schedule_competitor_shop_sync();
-- Two jobs, same call: Monday 05:30 UTC starts the weekly read of every shop
-- due; Monday 06:00-08:50 UTC, every 10 minutes, continues a read that the
-- ~2 minute time budget of one invocation could not finish (a shop with
-- nothing due is skipped, so those calls are cheap no-ops).
create function public.schedule_competitor_shop_sync()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_command constant text := $cmd$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'competitor_sync_url'),
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
               where name in ('competitor_check_secret', 'competitor_sync_url')$q$
      into v_have_secrets;
  exception when others then
    v_have_secrets := false;
  end;
  if not coalesce(v_have_secrets, false) then
    raise notice 'competitor shop sync not scheduled: create the vault secrets competitor_check_secret and competitor_sync_url, then run select public.schedule_competitor_shop_sync();';
    return 'not_scheduled: secrets missing';
  end if;

  begin
    create extension if not exists pg_net with schema extensions;
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job
      where jobname in ('sync-competitor-shops', 'sync-competitor-shops-resume');
    perform cron.schedule('sync-competitor-shops', '30 5 * * 1', v_command);
    perform cron.schedule('sync-competitor-shops-resume', '*/10 6-8 * * 1', v_command);
  exception when others then
    raise notice 'competitor shop sync not scheduled (pg_cron/pg_net unavailable): %', sqlerrm;
    return 'not_scheduled: ' || sqlerrm;
  end;
  return 'scheduled';
end;
$$;

revoke execute on function public.schedule_competitor_shop_sync() from public, anon, authenticated;

select public.schedule_competitor_shop_sync();
