create table stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  quantity_delta numeric(12, 3) not null check (quantity_delta <> 0),
  reason adjustment_reason not null,
  note text,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

create index idx_stock_adjustments_product on stock_adjustments (product_id, created_at desc);

create function public.apply_stock_adjustment()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update products
  set stock_quantity = stock_quantity + new.quantity_delta
  where id = new.product_id;

  return new;
end;
$$;

create trigger trg_stock_adjustments_after_insert
  after insert on stock_adjustments
  for each row execute function public.apply_stock_adjustment();
