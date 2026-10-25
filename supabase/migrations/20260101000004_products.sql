create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  barcode text unique,
  category_id uuid references categories (id) on delete set null,
  unit product_unit not null default 'piece',
  selling_price_cents bigint not null check (selling_price_cents >= 0),
  current_cost_cents bigint not null default 0 check (current_cost_cents >= 0),
  stock_quantity numeric(12, 3) not null default 0,
  low_stock_threshold numeric(12, 3) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Exact-match lookup (barcode scan)
create unique index idx_products_barcode on products (barcode) where barcode is not null;

-- Fast fuzzy name search across 10,000+ products
create index idx_products_name_trgm on products using gin (name gin_trgm_ops);

create index idx_products_category on products (category_id);
create index idx_products_active on products (active) where active = true;

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_products_updated_at
  before update on products
  for each row execute function public.set_updated_at();
