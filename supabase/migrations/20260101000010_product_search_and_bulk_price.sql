-- PostgREST filters cannot compare two columns, so low stock is materialized
-- as a generated column the API can filter and index on.
alter table products
  add column is_low_stock boolean
  generated always as (stock_quantity <= low_stock_threshold) stored;

create index idx_products_is_low_stock on products (is_low_stock) where is_low_stock;

-- Search hits name OR barcode in one query. Without a trigram index on
-- barcode the planner cannot combine the two and falls back to scanning
-- every product; with it, both sides are index scans joined by BitmapOr.
-- (The plain btree on barcode only serves prefix matching under a C
-- collation, which a hosted Postgres generally is not.)
create index idx_products_barcode_trgm on products using gin (barcode gin_trgm_ops);

create or replace view products_cashier_view as
select
  id, name, barcode, category_id, unit,
  selling_price_cents, stock_quantity, low_stock_threshold, active,
  created_at, updated_at, is_low_stock
from products;

grant select on products_cashier_view to authenticated;

-- Bulk selling-price change for a category. Runs as the caller, so the
-- products RLS update policy (owner only) decides whether anything changes:
-- a cashier calling this simply updates zero rows.
create function public.bulk_adjust_selling_price(p_category_id uuid, p_percent numeric)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  update products
  set selling_price_cents = greatest(0, round(selling_price_cents * (1 + p_percent / 100.0)))
  where (p_category_id is null or category_id = p_category_id)
    and active;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.bulk_adjust_selling_price(uuid, numeric) to authenticated;
