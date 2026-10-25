-- ============================================================
-- Views: cost/profit-bearing columns are simply not selected here.
-- Created by the migration role, which owns the view and bypasses
-- RLS on the underlying tables — these views are the only read
-- path cashiers get for product and sale-line data.
-- ============================================================

create view products_cashier_view as
select
  id, name, barcode, category_id, unit,
  selling_price_cents, stock_quantity, low_stock_threshold, active,
  created_at, updated_at
from products;

grant select on products_cashier_view to authenticated;

create view sale_items_cashier_view as
select
  si.id, si.sale_id, si.product_id, si.quantity,
  si.unit_price_cents, si.discount_cents, si.line_total_cents, si.created_at
from sale_items si
join sales s on s.id = si.sale_id
where s.cashier_id = auth.uid() or public.is_owner();

grant select on sale_items_cashier_view to authenticated;

-- ============================================================
-- Prevent a cashier from granting themselves the owner role by
-- updating their own profile row.
-- ============================================================

create function public.prevent_role_self_escalation()
returns trigger
language plpgsql
as $$
begin
  -- auth.uid() is null for direct/admin SQL (migrations, seed scripts,
  -- the service role) — only API requests authenticated as a non-owner
  -- are blocked from changing a role.
  if new.role <> old.role and auth.uid() is not null and not public.is_owner() then
    raise exception 'Only an owner can change a profile role';
  end if;
  return new;
end;
$$;

create trigger trg_prevent_role_self_escalation
  before update on profiles
  for each row execute function public.prevent_role_self_escalation();

-- ============================================================
-- Row Level Security
-- ============================================================

alter table profiles enable row level security;
alter table categories enable row level security;
alter table suppliers enable row level security;
alter table products enable row level security;
alter table cost_history enable row level security;
alter table purchases enable row level security;
alter table purchase_items enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table stock_adjustments enable row level security;

-- profiles
create policy "self or owner can read profiles" on profiles
  for select using (id = auth.uid() or public.is_owner());
create policy "owner manages profiles" on profiles
  for all using (public.is_owner()) with check (public.is_owner());
create policy "self can update own name" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- categories
create policy "anyone authenticated can read categories" on categories
  for select using (auth.role() = 'authenticated');
create policy "owner manages categories" on categories
  for insert with check (public.is_owner());
create policy "owner updates categories" on categories
  for update using (public.is_owner());
create policy "owner deletes categories" on categories
  for delete using (public.is_owner());

-- suppliers
create policy "anyone authenticated can read suppliers" on suppliers
  for select using (auth.role() = 'authenticated');
create policy "owner manages suppliers" on suppliers
  for insert with check (public.is_owner());
create policy "owner updates suppliers" on suppliers
  for update using (public.is_owner());
create policy "owner deletes suppliers" on suppliers
  for delete using (public.is_owner());

-- products (base table: has cost column, owner-only; cashiers use the view)
create policy "owner reads products" on products
  for select using (public.is_owner());
create policy "owner manages products" on products
  for all using (public.is_owner()) with check (public.is_owner());

-- cost_history (owner-only, read-only from the app; writes come from the
-- security-definer purchase trigger, which bypasses RLS)
create policy "owner reads cost history" on cost_history
  for select using (public.is_owner());

-- purchases
create policy "owner reads purchases" on purchases
  for select using (public.is_owner());
create policy "staff record purchases" on purchases
  for insert with check (created_by = auth.uid());
create policy "owner manages purchases" on purchases
  for update using (public.is_owner());
create policy "owner deletes purchases" on purchases
  for delete using (public.is_owner());

-- purchase_items (owner-only read: contains unit_cost_cents)
create policy "owner reads purchase items" on purchase_items
  for select using (public.is_owner());
create policy "staff record purchase items" on purchase_items
  for insert with check (
    exists (select 1 from purchases where id = purchase_id and created_by = auth.uid())
    or public.is_owner()
  );

-- sales (no cost column; cashiers see their own, owner sees all)
create policy "staff read own sales, owner reads all" on sales
  for select using (cashier_id = auth.uid() or public.is_owner());
create policy "staff record sales" on sales
  for insert with check (cashier_id = auth.uid());
create policy "owner voids sales" on sales
  for update using (public.is_owner());
create policy "owner deletes sales" on sales
  for delete using (public.is_owner());

-- sale_items (owner-only on the base table: contains unit_cost_cents;
-- cashiers read via sale_items_cashier_view instead)
create policy "owner reads sale items" on sale_items
  for select using (public.is_owner());
create policy "staff record sale items" on sale_items
  for insert with check (
    exists (
      select 1 from sales
      where id = sale_id and (cashier_id = auth.uid() or public.is_owner())
    )
  );

-- stock_adjustments
create policy "staff read own adjustments, owner reads all" on stock_adjustments
  for select using (created_by = auth.uid() or public.is_owner());
create policy "staff record adjustments" on stock_adjustments
  for insert with check (created_by = auth.uid());
