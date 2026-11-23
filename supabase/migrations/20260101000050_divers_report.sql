-- Reports: Divers as its own line, and out of the per-product rankings.
--
-- Divers (kind = 'misc') is a free-amount item whose cost is ESTIMATED from the
-- owner's margin (sale_items.cost_estimated), so its profit is not a real
-- per-product margin. It stays inside the headline numbers (report_summary,
-- daily trend, hours, category are untouched: it is real money) but
--   1. report_divers shows it on its own, flagged as estimated by the app;
--   2. report_product_performance no longer returns it, so it cannot top "best
--      profit" or "lowest margin".
-- Dead stock and inventory value already ignore it (it tracks no stock and
-- report_dead_stock / report_inventory_value read products with a stock filter).
-- report_by_category is left alone: Divers has no category, so it lands in
-- the "Uncategorised" bucket, which is true to the money taken.
--
-- Append-only: report_product_performance below is 046's, byte for byte, with ONE
-- added condition (marked). Create or replace keeps the existing grants.

create or replace function public.report_product_performance(p_from timestamptz, p_to timestamptz)
returns table (
  product_id uuid,
  product_name text,
  unit product_unit,
  quantity numeric,
  revenue_cents bigint,
  profit_cents bigint,
  margin_percent numeric
)
language plpgsql
stable
as $$
begin
  if not public.is_owner() then
    raise exception 'Reports are owner only';
  end if;

  return query
  with moves as (
    select e.product_id as product_id, e.quantity as qty, e.net_revenue_cents as rev, e.cost_cents as cost
    from sale_line_economics e
    where e.occurred_at >= p_from and e.occurred_at < p_to
    union all
    select r.product_id, -r.quantity, -r.net_revenue_cents, -r.cost_cents
    from sale_return_economics r
    where r.returned_at >= p_from and r.returned_at < p_to
  )
  select
    m.product_id,
    p.name,
    p.unit,
    sum(m.qty),
    sum(m.rev)::bigint,
    sum(m.rev - m.cost)::bigint,
    case when sum(m.rev) > 0
      then round(sum(m.rev - m.cost)::numeric * 100 / sum(m.rev), 2)
      else null
    end
  from moves m
  join products p on p.id = m.product_id
  -- Divers (kind = 'misc') is reported on its own line (report_divers), never ranked.
  where p.kind <> 'misc'
  group by m.product_id, p.name, p.unit;
end;
$$;

-- report_divers: one row for the period. Sold lines come from sale_line_economics
-- (voided sales excluded, sale discount already allocated), returned lines from
-- sale_return_economics (by returned_at, taken off), exactly like the product
-- performance above. cost_cents is the ESTIMATED cost stamped at sale time.
create function public.report_divers(p_from timestamptz, p_to timestamptz)
returns table (
  line_count bigint,
  returned_count bigint,
  revenue_cents bigint,
  cost_cents bigint,
  profit_cents bigint
)
language plpgsql
stable
as $$
begin
  if not public.is_owner() then
    raise exception 'Reports are owner only' using errcode = '42501';
  end if;

  return query
  with moves as (
    select 1 as sold, 0 as returned, e.net_revenue_cents as rev, e.cost_cents as cost
    from sale_line_economics e
    join products p on p.id = e.product_id
    where p.kind = 'misc'
      and e.occurred_at >= p_from and e.occurred_at < p_to
    union all
    select 0, 1, -r.net_revenue_cents, -r.cost_cents
    from sale_return_economics r
    join products p on p.id = r.product_id
    where p.kind = 'misc'
      and r.returned_at >= p_from and r.returned_at < p_to
  )
  select
    coalesce(sum(m.sold), 0)::bigint,
    coalesce(sum(m.returned), 0)::bigint,
    coalesce(sum(m.rev), 0)::bigint,
    coalesce(sum(m.cost), 0)::bigint,
    coalesce(sum(m.rev - m.cost), 0)::bigint
  from moves m;
end;
$$;

revoke execute on function public.report_divers(timestamptz, timestamptz) from public, anon;
grant execute on function public.report_divers(timestamptz, timestamptz) to authenticated;
