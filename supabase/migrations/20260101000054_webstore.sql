-- Webstore catalogue. The owner's public webstore (a static page) reads one JSON
-- feed. The catalogue now lives here and webstore_feed() builds that exact JSON;
-- the public edge function 'webstore-feed' serves it.
--
-- Web products are their OWN rows, optionally linked to an app product:
--   linked   -> price = the app product's selling price, stock may follow stock_quantity
--   unlinked -> price typed on the web row (null = "prix à confirmer"), stock by hand
-- Everything is owner only. The feed never exposes cost, stock quantities or any
-- column outside the page's contract.

-------------------------------------------------------------------------------
-- 1. Tables
-------------------------------------------------------------------------------
create table public.web_categories (
  id text primary key check (id ~ '^[a-z][a-z0-9]{1,19}$'),
  name text not null check (length(name) <= 120),
  name_fr text not null check (length(name_fr) <= 120),
  icon text not null default 'bag',
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.web_subcategories (
  category_id text not null references public.web_categories (id) on update cascade on delete cascade,
  code text not null check (length(code) between 1 and 40),
  name text not null check (length(name) <= 120),
  name_fr text not null check (length(name_fr) <= 120),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (category_id, code)
);

create table public.web_products (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,20}$'),
  product_id uuid references public.products (id) on delete set null,
  name text not null check (length(name) <= 120),
  name_fr text check (length(name_fr) <= 120),
  size text,
  category_id text not null references public.web_categories (id) on update cascade,
  sub_code text,
  -- MATCH SIMPLE (the default): a null sub_code skips the check.
  foreign key (category_id, sub_code)
    references public.web_subcategories (category_id, code) on update cascade,
  popular boolean not null default false,
  keywords text,
  image_url text check (image_url is null or image_url ~ '^https://'),
  price_cents bigint check (price_cents >= 0),
  stock_mode text not null default 'manual' check (stock_mode in ('manual', 'auto')),
  manual_in_stock boolean not null default true,
  published boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stock_mode = 'manual' or product_id is not null)
);
create index idx_web_products_product on public.web_products (product_id) where product_id is not null;
create index idx_web_products_category on public.web_products (category_id);

create table public.web_kits (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  name text not null check (length(name) <= 60),
  name_fr text check (length(name_fr) <= 60),
  published boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- web_product_id has NO foreign key on purpose: imported kits can reference ids
-- that no longer exist. The app flags them and the page hides such kits.
create table public.web_kit_items (
  kit_id text not null references public.web_kits (id) on update cascade on delete cascade,
  web_product_id text not null,
  qty int not null check (qty between 1 and 10),
  sort int not null default 0,
  primary key (kit_id, web_product_id)
);

-- One row. The page uses the version to know the catalogue changed.
create table public.webstore_state (
  id boolean primary key default true check (id),
  version bigint not null
);
insert into public.webstore_state (id, version) values (true, 100);

-------------------------------------------------------------------------------
-- 2. Triggers
-------------------------------------------------------------------------------
create trigger trg_web_categories_updated_at before update on public.web_categories
  for each row execute function public.set_updated_at();
create trigger trg_web_subcategories_updated_at before update on public.web_subcategories
  for each row execute function public.set_updated_at();
create trigger trg_web_products_updated_at before update on public.web_products
  for each row execute function public.set_updated_at();
create trigger trg_web_kits_updated_at before update on public.web_kits
  for each row execute function public.set_updated_at();

-- When the linked app product is deleted (on delete set null) an 'auto' row
-- would break its own check: it falls back to manual stock instead.
create function public.web_products_unlinked_to_manual()
returns trigger
language plpgsql
as $$
begin
  if old.product_id is not null and new.product_id is null and new.stock_mode = 'auto' then
    new.stock_mode := 'manual';
  end if;
  return new;
end;
$$;
create trigger trg_web_products_unlinked
  before update on public.web_products
  for each row execute function public.web_products_unlinked_to_manual();

-- The miscellaneous "Divers" product has no real price or stock: not linkable.
create function public.web_products_no_misc_link()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.product_id is not null
     and exists (select 1 from public.products where id = new.product_id and kind = 'misc') then
    raise exception 'the miscellaneous product cannot be linked to a web product'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger trg_web_products_no_misc
  before insert or update of product_id on public.web_products
  for each row execute function public.web_products_no_misc_link();

-- Any change to the catalogue bumps the feed version (once per statement).
create function public.webstore_bump_version()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.webstore_state set version = version + 1;
  return null;
end;
$$;
create trigger trg_web_categories_version after insert or update or delete on public.web_categories
  for each statement execute function public.webstore_bump_version();
create trigger trg_web_subcategories_version after insert or update or delete on public.web_subcategories
  for each statement execute function public.webstore_bump_version();
create trigger trg_web_products_version after insert or update or delete on public.web_products
  for each statement execute function public.webstore_bump_version();
create trigger trg_web_kits_version after insert or update or delete on public.web_kits
  for each statement execute function public.webstore_bump_version();
create trigger trg_web_kit_items_version after insert or update or delete on public.web_kit_items
  for each statement execute function public.webstore_bump_version();

-------------------------------------------------------------------------------
-- 3. RLS and grants: owner only, nothing for anon
-------------------------------------------------------------------------------
alter table public.web_categories enable row level security;
alter table public.web_subcategories enable row level security;
alter table public.web_products enable row level security;
alter table public.web_kits enable row level security;
alter table public.web_kit_items enable row level security;
alter table public.webstore_state enable row level security;

create policy "owner manages web categories" on public.web_categories
  for all using (public.is_owner()) with check (public.is_owner());
create policy "owner manages web subcategories" on public.web_subcategories
  for all using (public.is_owner()) with check (public.is_owner());
create policy "owner manages web products" on public.web_products
  for all using (public.is_owner()) with check (public.is_owner());
create policy "owner manages web kits" on public.web_kits
  for all using (public.is_owner()) with check (public.is_owner());
create policy "owner manages web kit items" on public.web_kit_items
  for all using (public.is_owner()) with check (public.is_owner());
create policy "owner reads webstore state" on public.webstore_state
  for select using (public.is_owner());

-- Tables are not auto-granted to `authenticated` on recently created hosted
-- projects, so the grants are explicit. RLS above limits them to the owner.
revoke all on public.web_categories, public.web_subcategories, public.web_products,
  public.web_kits, public.web_kit_items, public.webstore_state
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.web_categories, public.web_subcategories, public.web_products,
     public.web_kits, public.web_kit_items
  to authenticated;
grant select on public.webstore_state to authenticated;

-------------------------------------------------------------------------------
-- 4. The feed: exactly the JSON the page validates
-------------------------------------------------------------------------------
create function public.webstore_feed()
returns jsonb
language plpgsql
security definer set search_path = public
stable
as $$
declare
  v_result jsonb;
begin
  if not (auth.role() = 'service_role' or public.is_owner()) then
    raise exception 'owner only' using errcode = '42501';
  end if;

  with feed_products as (
    select
      wp.id, wp.name, wp.name_fr, wp.size, wp.category_id, wp.sub_code,
      wp.popular, wp.keywords, wp.image_url, wp.sort, c.sort as category_sort,
      case when wp.product_id is null then wp.price_cents else p.selling_price_cents end as cents,
      case when wp.stock_mode = 'auto' then p.stock_quantity > 0 else wp.manual_in_stock end as in_stock
    from public.web_products wp
    join public.web_categories c on c.id = wp.category_id
    left join public.products p on p.id = wp.product_id
    where wp.published
      and (wp.product_id is null or (p.active and p.kind <> 'misc'))
  ),
  feed_subs as (
    select s.category_id, s.code, s.name, s.name_fr, s.sort
    from public.web_subcategories s
    where exists (
      select 1 from feed_products fp where fp.category_id = s.category_id and fp.sub_code = s.code
    )
  ),
  feed_categories as (
    select c.id, c.name, c.name_fr, c.icon, c.sort,
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', s.code, 'name', s.name, 'name_fr', s.name_fr)
          order by s.sort, s.code)
        from feed_subs s where s.category_id = c.id
      ), '[]'::jsonb) as subs
    from public.web_categories c
    where exists (select 1 from feed_products fp where fp.category_id = c.id)
  ),
  feed_kits as (
    select k.id, k.name, k.name_fr, k.sort
    from public.web_kits k
    where k.published and exists (select 1 from public.web_kit_items i where i.kit_id = k.id)
    order by k.sort, k.id
    limit 20
  )
  select jsonb_build_object(
    'version', (select version from public.webstore_state),
    'generated_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', c.id, 'name', c.name, 'name_fr', c.name_fr, 'icon', c.icon, 'subs', c.subs)
        order by c.sort, c.id)
      from feed_categories c
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', fp.id,
          'name', fp.name,
          'name_fr', nullif(fp.name_fr, ''),
          'size', nullif(fp.size, ''),
          'cat', fp.category_id,
          'sub', fp.sub_code,
          'price', case when fp.cents is null then null else trim_scale(round(fp.cents / 100.0, 2)) end,
          'stock', fp.in_stock,
          'popular', fp.popular,
          'image', nullif(fp.image_url, ''),
          'keywords', nullif(fp.keywords, ''))
        order by fp.category_sort, fp.sort, fp.id)
      from feed_products fp
    ), '[]'::jsonb),
    'kits', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', k.id,
          'name', k.name,
          'name_fr', nullif(k.name_fr, ''),
          'items', (
            select coalesce(jsonb_agg(jsonb_build_object('id', i.web_product_id, 'qty', i.qty)
                                      order by i.sort, i.web_product_id), '[]'::jsonb)
            from (
              select * from public.web_kit_items ki where ki.kit_id = k.id
              order by ki.sort, ki.web_product_id limit 12
            ) i
          ))
        order by k.sort, k.id)
      from feed_kits k
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.webstore_feed() from public, anon;
grant execute on function public.webstore_feed() to authenticated, service_role;
