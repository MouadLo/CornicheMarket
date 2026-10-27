-- ============================================================
-- sale_line_economics: largest-remainder discount allocation.
--
-- A sale-level discount belongs to the sale, not to any one line, so it is
-- shared across that sale's lines in proportion to their value.
--
-- The previous version rounded each line's share independently, which does
-- NOT guarantee the parts sum to the sale's discount: lines of 3.33, 3.33
-- and 3.34 DH sharing a 10-cent discount each round to 3 cents, summing to
-- 9, not 10. Six 1-cent lines sharing a 5-cent discount each round to 1,
-- summing to 6, not 5. Both drift the per-product reports away from the
-- headline total they are supposed to add up to.
--
-- This replaces that with the largest-remainder method: floor every line's
-- exact share, then hand the leftover centimes -- always a non-negative
-- integer, strictly fewer than the number of lines in the sale -- one at a
-- time to the lines with the biggest fractional remainder (ties broken by
-- id, for a deterministic result). That guarantees allocated_discount_cents
-- always sums to the sale's discount_cents exactly, which in turn
-- guarantees net_revenue_cents sums to the sale's total, and line profit
-- (net_revenue_cents - cost_cents) sums to the sale's own gross profit.
-- ============================================================

create or replace view sale_line_economics as
with lines as (
  select
    si.id,
    si.sale_id,
    si.product_id,
    si.quantity,
    si.line_total_cents,
    si.unit_cost_cents,
    s.created_at,
    s.occurred_at,
    s.discount_cents as sale_discount_cents,
    sum(si.line_total_cents) over (partition by si.sale_id) as sale_lines_total
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.voided_at is null
),
exact as (
  select
    *,
    case
      when sale_lines_total > 0
        then sale_discount_cents * line_total_cents::numeric / sale_lines_total
      else 0
    end as exact_discount
  from lines
),
floored as (
  select
    *,
    floor(exact_discount)::bigint as floor_discount,
    exact_discount - floor(exact_discount) as remainder
  from exact
),
ranked as (
  select
    *,
    sale_discount_cents - sum(floor_discount) over (partition by sale_id) as leftover,
    row_number() over (partition by sale_id order by remainder desc, id) as remainder_rank
  from floored
)
select
  id,
  sale_id,
  product_id,
  created_at,
  occurred_at,
  quantity,
  line_total_cents,
  (floor_discount + case when remainder_rank <= leftover then 1 else 0 end)::bigint
    as allocated_discount_cents,
  (line_total_cents
    - (floor_discount + case when remainder_rank <= leftover then 1 else 0 end)
  )::bigint as net_revenue_cents,
  round(unit_cost_cents * quantity)::bigint as cost_cents
from ranked
where public.is_owner();

grant select on sale_line_economics to authenticated;
