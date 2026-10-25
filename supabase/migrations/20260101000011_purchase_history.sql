-- "Last price paid" is read per product on every Stock In line, newest first.
create index idx_purchase_items_product_recent
  on purchase_items (product_id, created_at desc);

-- Reporting views for purchase history. Each carries its own is_owner()
-- guard: a view runs with its creator's rights and so bypasses the RLS on
-- purchases/purchase_items, which is exactly what must not leak to cashiers.
create view purchase_summaries as
select
  p.id,
  p.purchase_date,
  p.notes,
  p.supplier_id,
  s.name as supplier_name,
  coalesce(round(sum(pi.quantity * pi.unit_cost_cents)), 0)::bigint as total_cents,
  count(pi.id) as line_count
from purchases p
left join suppliers s on s.id = p.supplier_id
left join purchase_items pi on pi.purchase_id = p.id
where public.is_owner()
group by p.id, s.name;

create view purchase_monthly_totals as
select
  date_trunc('month', p.purchase_date) as month,
  coalesce(round(sum(pi.quantity * pi.unit_cost_cents)), 0)::bigint as total_cents,
  count(distinct p.id) as purchase_count
from purchases p
left join purchase_items pi on pi.purchase_id = p.id
where public.is_owner()
group by date_trunc('month', p.purchase_date);

create view purchase_supplier_totals as
select
  p.supplier_id,
  coalesce(s.name, 'No supplier') as supplier_name,
  coalesce(round(sum(pi.quantity * pi.unit_cost_cents)), 0)::bigint as total_cents,
  count(distinct p.id) as purchase_count
from purchases p
left join suppliers s on s.id = p.supplier_id
left join purchase_items pi on pi.purchase_id = p.id
where public.is_owner()
group by p.supplier_id, s.name;

grant select on purchase_summaries to authenticated;
grant select on purchase_monthly_totals to authenticated;
grant select on purchase_supplier_totals to authenticated;
