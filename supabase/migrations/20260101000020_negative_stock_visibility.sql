-- ============================================================
-- B4: stock can go negative (selling what's physically on the counter
-- must never be blocked), but it must never be invisible.
--
-- Three pieces:
--   1. sale_items.oversold: did THIS line drive stock below zero.
--   2. products.stock_went_negative_at: when this product's stock last
--      crossed from >=0 to <0, cleared the moment it's resolved -- the
--      "how long has it been negative" signal for the owner screen.
--   3. report_inventory_value: floors each product's contribution at
--      zero before summing, so one oversold item can't offset real
--      stock, with the un-floored discrepancy surfaced separately
--      rather than silently absorbed.
-- ============================================================

alter table sale_items add column oversold boolean not null default false;

-- Reads the product's CURRENT stock (before this line's own decrement,
-- since this is a BEFORE trigger and the AFTER trigger that decrements
-- stock hasn't run yet) in the same query that already stamps cost, so
-- this costs no extra round trip.
create or replace function public.stamp_sale_item_cost()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_current_stock numeric;
begin
  select current_cost_cents, stock_quantity into new.unit_cost_cents, v_current_stock
  from products
  where id = new.product_id;

  new.line_total_cents := (new.quantity * new.unit_price_cents)::bigint - new.discount_cents;
  new.oversold := v_current_stock < new.quantity;

  return new;
end;
$$;

alter table products add column stock_went_negative_at timestamptz;

-- Fires on any change to stock_quantity, regardless of which path caused
-- it (sale, purchase, or manual adjustment), so it stays correct without
-- needing to be duplicated into apply_purchase_item / apply_stock_adjustment.
create function public.track_negative_stock()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.stock_quantity < 0 and old.stock_quantity >= 0 then
    new.stock_went_negative_at := now();
  elsif new.stock_quantity >= 0 then
    new.stock_went_negative_at := null;
  end if;
  return new;
end;
$$;

create trigger trg_products_track_negative_stock
  before update on products
  for each row
  when (new.stock_quantity is distinct from old.stock_quantity)
  execute function public.track_negative_stock();

-- Owner-only, same pattern as the other cost-adjacent views: the view's own
-- is_owner() filter is what matters since it bypasses RLS on products.
create view negative_stock_products as
select
  id as product_id,
  name as product_name,
  unit,
  stock_quantity,
  current_cost_cents,
  stock_went_negative_at
from products
where stock_quantity < 0
  and public.is_owner();

grant select on negative_stock_products to authenticated;

-- Each product's contribution to value is floored at zero before summing,
-- so one oversold item can't offset the value of real stock elsewhere.
-- oversold_value_cents surfaces what was excluded (always <= 0) instead of
-- letting it vanish silently.
--
-- This ADDS a return column (oversold_value_cents), and `create or replace
-- function` cannot change a function's return type -- only its body --
-- unlike `create or replace view`, which can at least append columns.
-- Changing the return type requires dropping the function first. The drop
-- also removes its grant, so the grant below re-adds it.
drop function if exists public.report_inventory_value();

create function public.report_inventory_value()
returns table (
  product_count bigint,
  unit_count numeric,
  cost_value_cents bigint,
  retail_value_cents bigint,
  potential_profit_cents bigint,
  oversold_value_cents bigint
)
language plpgsql
stable
as $$
begin
  if not public.is_owner() then
    raise exception 'Reports are owner only';
  end if;

  return query
  select
    count(*) filter (where p.stock_quantity > 0)::bigint,
    coalesce(sum(greatest(p.stock_quantity, 0)), 0),
    coalesce(round(sum(greatest(p.stock_quantity, 0) * p.current_cost_cents)), 0)::bigint,
    coalesce(round(sum(greatest(p.stock_quantity, 0) * p.selling_price_cents)), 0)::bigint,
    coalesce(
      round(
        sum(greatest(p.stock_quantity, 0) * p.selling_price_cents)
        - sum(greatest(p.stock_quantity, 0) * p.current_cost_cents)
      ),
      0
    )::bigint,
    coalesce(round(sum(least(p.stock_quantity, 0) * p.current_cost_cents)), 0)::bigint
  from products p
  where p.active and p.stock_quantity <> 0;
end;
$$;

grant execute on function public.report_inventory_value() to authenticated;
