create table sales (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid not null references profiles (id),
  payment_method payment_method not null default 'cash',
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  created_at timestamptz not null default now()
);

create table sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales (id) on delete cascade,
  product_id uuid not null references products (id),
  quantity numeric(12, 3) not null check (quantity > 0),
  -- Snapshotted at insert time so historical profit stays correct
  -- even after selling_price or cost later change.
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  line_total_cents bigint not null check (line_total_cents >= 0),
  created_at timestamptz not null default now()
);

create index idx_sales_cashier on sales (cashier_id, created_at desc);
create index idx_sales_created_at on sales (created_at desc);
create index idx_sale_items_sale on sale_items (sale_id);
create index idx_sale_items_product on sale_items (product_id, created_at desc);

-- unit_cost_cents is never trusted from the client: it is always stamped
-- from the product's current weighted-average cost, which also keeps
-- cashiers (who cannot read cost) from ever having to supply it.
create function public.stamp_sale_item_cost()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  select current_cost_cents into new.unit_cost_cents
  from products
  where id = new.product_id;

  new.line_total_cents := (new.quantity * new.unit_price_cents)::bigint - new.discount_cents;

  return new;
end;
$$;

create trigger trg_sale_items_before_insert
  before insert on sale_items
  for each row execute function public.stamp_sale_item_cost();

create function public.apply_sale_item_stock()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update products
  set stock_quantity = stock_quantity - new.quantity
  where id = new.product_id;

  return new;
end;
$$;

create trigger trg_sale_items_after_insert
  after insert on sale_items
  for each row execute function public.apply_sale_item_stock();
