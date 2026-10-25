-- ============================================================
-- Losses need the cost at the moment stock was written off, the same way
-- sale_items snapshots cost: today's average cost is the wrong number to
-- value last month's breakage with.
-- ============================================================
alter table stock_adjustments add column unit_cost_cents bigint;

create function public.stamp_adjustment_cost()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  select current_cost_cents into new.unit_cost_cents
  from products
  where id = new.product_id;
  return new;
end;
$$;

create trigger trg_stock_adjustments_cost
  before insert on stock_adjustments
  for each row execute function public.stamp_adjustment_cost();

-- That new column is cost data, so the old policy letting cashiers read
-- their own adjustment rows would now leak it. Reads become owner-only and
-- cashiers get a view with no cost column instead.
drop policy "staff read own adjustments, owner reads all" on stock_adjustments;

create policy "owner reads adjustments" on stock_adjustments
  for select using (public.is_owner());

create view stock_adjustments_cashier_view as
select
  sa.id, sa.product_id, p.name as product_name, p.unit,
  sa.quantity_delta, sa.reason, sa.note, sa.created_by, sa.created_at
from stock_adjustments sa
join products p on p.id = sa.product_id
where sa.created_by = auth.uid() or public.is_owner();

grant select on stock_adjustments_cashier_view to authenticated;

-- ============================================================
-- Optional expiry per delivered batch.
-- ============================================================
alter table purchase_items add column expiry_date date;

create index idx_purchase_items_expiry
  on purchase_items (expiry_date)
  where expiry_date is not null;

-- Quantities and dates only: no cost, so cashiers can pull expiring stock
-- off the shelves without seeing what it cost.
create view expiring_batches as
select
  pi.id,
  pi.product_id,
  p.name as product_name,
  p.unit,
  p.stock_quantity,
  pi.quantity as delivered_quantity,
  pi.expiry_date,
  (pi.expiry_date - current_date) as days_left
from purchase_items pi
join products p on p.id = pi.product_id
where pi.expiry_date is not null
  and p.active;

grant select on expiring_batches to authenticated;

-- ============================================================
-- Sales velocity for reorder suggestions. Quantities only.
-- ============================================================
create view product_sales_30d as
select
  si.product_id,
  sum(si.quantity) as quantity_sold,
  count(distinct s.id) as sale_count
from sale_items si
join sales s on s.id = si.sale_id
where s.voided_at is null
  and s.created_at >= now() - interval '30 days'
group by si.product_id;

grant select on product_sales_30d to authenticated;

-- A shelf count is applied as an ordinary count_correction adjustment whose
-- delta is (counted - what the device was showing). The existing trigger adds
-- that delta to the live quantity rather than assigning it, so a sale rung up
-- midway through a count still counts: the correction records the discrepancy
-- that was found, not a new absolute stock level.
