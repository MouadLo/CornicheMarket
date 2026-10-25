create table purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers (id) on delete set null,
  created_by uuid not null references profiles (id),
  purchase_date timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

create table purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases (id) on delete cascade,
  product_id uuid not null references products (id),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  created_at timestamptz not null default now()
);

alter table cost_history
  add constraint cost_history_purchase_item_fk
  foreign key (purchase_item_id) references purchase_items (id) on delete set null;

create index idx_purchase_items_purchase on purchase_items (purchase_id);
create index idx_purchase_items_product on purchase_items (product_id);

-- Stock in + weighted-average cost update, fired on every delivery line.
-- new_avg_cost = (old_qty * old_cost + bought_qty * bought_cost) / (old_qty + bought_qty)
create function public.apply_purchase_item()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_old_qty numeric(12, 3);
  v_old_cost bigint;
  v_new_cost bigint;
begin
  select stock_quantity, current_cost_cents into v_old_qty, v_old_cost
  from products
  where id = new.product_id
  for update;

  if v_old_qty <= 0 then
    v_new_cost := new.unit_cost_cents;
  else
    v_new_cost := round(
      (v_old_qty * v_old_cost + new.quantity * new.unit_cost_cents)
      / (v_old_qty + new.quantity)
    );
  end if;

  update products
  set stock_quantity = stock_quantity + new.quantity,
      current_cost_cents = v_new_cost
  where id = new.product_id;

  insert into cost_history (product_id, cost_cents, source, purchase_item_id)
  values (new.product_id, v_new_cost, 'purchase', new.id);

  return new;
end;
$$;

create trigger trg_purchase_items_after_insert
  after insert on purchase_items
  for each row execute function public.apply_purchase_item();
