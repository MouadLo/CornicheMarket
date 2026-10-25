-- ============================================================
-- Security hardening: add security_barrier to views that filter
-- by auth.uid(). Without the barrier the planner can push a
-- user-supplied function past the WHERE clause before the
-- auth check runs, potentially leaking rows to the wrong user.
-- The products_cashier_view has no WHERE clause so it is not
-- affected, but the other three have uid() checks.
-- ============================================================

create or replace view sale_items_cashier_view
  with (security_barrier = true)
as
select
  si.id, si.sale_id, si.product_id, si.quantity,
  si.unit_price_cents, si.discount_cents, si.line_total_cents, si.created_at
from sale_items si
join sales s on s.id = si.sale_id
where s.cashier_id = auth.uid() or public.is_owner();

grant select on sale_items_cashier_view to authenticated;

create or replace view stock_adjustments_cashier_view
  with (security_barrier = true)
as
select
  sa.id, sa.product_id, p.name as product_name, p.unit,
  sa.quantity_delta, sa.reason, sa.note, sa.created_by, sa.created_at
from stock_adjustments sa
join products p on p.id = sa.product_id
where sa.created_by = auth.uid() or public.is_owner();

grant select on stock_adjustments_cashier_view to authenticated;

-- customer_balances aggregates from the sales and customer_payments tables
-- and has no per-row uid() filter (it shows all customers), so no barrier
-- is needed. The underlying tables already enforce RLS at insert time.
