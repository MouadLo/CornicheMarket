-- ============================================================
-- One row per sold line, carrying the economics every report needs.
--
-- A sale-level discount belongs to the sale, not to any one line, so it is
-- shared across that sale's lines in proportion to their value. Without
-- this, per-product profit would ignore basket discounts and the product
-- tables would not reconcile with the headline profit.
--
-- Voided sales are excluded everywhere: a refunded sale is not revenue.
-- Cost comes from the snapshot taken when the sale was rung up, never from
-- today's average cost.
-- ============================================================
create view sale_line_economics as
with lines as (
  select
    si.id,
    si.sale_id,
    si.product_id,
    si.quantity,
    si.line_total_cents,
    si.unit_cost_cents,
    s.created_at,
    s.discount_cents as sale_discount_cents,
    sum(si.line_total_cents) over (partition by si.sale_id) as sale_lines_total
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.voided_at is null
)
select
  id,
  sale_id,
  product_id,
  created_at,
  quantity,
  line_total_cents,
  case
    when sale_lines_total > 0
      then round(sale_discount_cents * line_total_cents::numeric / sale_lines_total)
    else 0
  end::bigint as allocated_discount_cents,
  (line_total_cents - case
    when sale_lines_total > 0
      then round(sale_discount_cents * line_total_cents::numeric / sale_lines_total)
    else 0
  end)::bigint as net_revenue_cents,
  round(unit_cost_cents * quantity)::bigint as cost_cents
from lines
where public.is_owner();

grant select on sale_line_economics to authenticated;

-- ============================================================
-- Headline figures for a date range.
-- ============================================================
create function public.report_summary(p_from timestamptz, p_to timestamptz)
returns table (
  revenue_cents bigint,
  cogs_cents bigint,
  gross_profit_cents bigint,
  margin_percent numeric,
  transaction_count bigint,
  average_basket_cents bigint,
  loss_cents bigint
)
language plpgsql
stable
as $$
begin
  if not public.is_owner() then
    raise exception 'Reports are owner only';
  end if;

  return query
  with sales_in_range as (
    select s.id, s.total_cents
    from sales s
    where s.voided_at is null
      and s.created_at >= p_from
      and s.created_at < p_to
  ),
  costs as (
    select coalesce(sum(e.cost_cents), 0) as cogs
    from sale_line_economics e
    where e.created_at >= p_from and e.created_at < p_to
  ),
  losses as (
    -- Only write-offs count as losses; a positive correction is stock found.
    select coalesce(sum(-sa.quantity_delta * coalesce(sa.unit_cost_cents, 0)), 0) as lost
    from stock_adjustments sa
    where sa.quantity_delta < 0
      and sa.created_at >= p_from
      and sa.created_at < p_to
  ),
  totals as (
    select
      coalesce(sum(sir.total_cents), 0)::bigint as revenue,
      count(*)::bigint as txn
    from sales_in_range sir
  )
  select
    t.revenue,
    c.cogs::bigint,
    (t.revenue - c.cogs)::bigint,
    case when t.revenue > 0
      then round((t.revenue - c.cogs)::numeric * 100 / t.revenue, 2)
      else null
    end,
    t.txn,
    case when t.txn > 0 then round(t.revenue::numeric / t.txn)::bigint else 0 end,
    round(l.lost)::bigint
  from totals t, costs c, losses l;
end;
$$;

-- ============================================================
-- Daily trend. Grouped in the store's own timezone, otherwise an evening
-- sale lands on the wrong day.
-- ============================================================
create function public.report_daily_trend(
  p_from timestamptz,
  p_to timestamptz,
  p_tz text default 'Africa/Casablanca'
)
returns table (
  day date,
  revenue_cents bigint,
  profit_cents bigint,
  transaction_count bigint
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
    (e.created_at at time zone p_tz)::date as day,
    coalesce(sum(e.net_revenue_cents), 0)::bigint,
    coalesce(sum(e.net_revenue_cents - e.cost_cents), 0)::bigint,
    count(distinct e.sale_id)::bigint
  from sale_line_economics e
  where e.created_at >= p_from and e.created_at < p_to
  group by (e.created_at at time zone p_tz)::date
  order by day;
end;
$$;

-- ============================================================
-- Sales by category.
-- ============================================================
create function public.report_by_category(p_from timestamptz, p_to timestamptz)
returns table (
  category_id uuid,
  category_name text,
  quantity numeric,
  revenue_cents bigint,
  profit_cents bigint
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
    p.category_id,
    coalesce(c.name, 'Uncategorised') as category_name,
    coalesce(sum(e.quantity), 0),
    coalesce(sum(e.net_revenue_cents), 0)::bigint,
    coalesce(sum(e.net_revenue_cents - e.cost_cents), 0)::bigint
  from sale_line_economics e
  join products p on p.id = e.product_id
  left join categories c on c.id = p.category_id
  where e.created_at >= p_from and e.created_at < p_to
  group by p.category_id, c.name
  order by 4 desc;
end;
$$;

-- ============================================================
-- Sales by hour of day, to show when the counter is busy.
-- ============================================================
create function public.report_by_hour(
  p_from timestamptz,
  p_to timestamptz,
  p_tz text default 'Africa/Casablanca'
)
returns table (
  hour integer,
  revenue_cents bigint,
  transaction_count bigint
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
    extract(hour from (e.created_at at time zone p_tz))::integer as hour,
    coalesce(sum(e.net_revenue_cents), 0)::bigint,
    count(distinct e.sale_id)::bigint
  from sale_line_economics e
  where e.created_at >= p_from and e.created_at < p_to
  group by 1
  order by 1;
end;
$$;

-- ============================================================
-- Product performance over the range.
-- ============================================================
create function public.report_product_performance(p_from timestamptz, p_to timestamptz)
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
  select
    e.product_id,
    p.name,
    p.unit,
    sum(e.quantity),
    sum(e.net_revenue_cents)::bigint,
    sum(e.net_revenue_cents - e.cost_cents)::bigint,
    case when sum(e.net_revenue_cents) > 0
      then round(sum(e.net_revenue_cents - e.cost_cents)::numeric * 100 / sum(e.net_revenue_cents), 2)
      else null
    end
  from sale_line_economics e
  join products p on p.id = e.product_id
  where e.created_at >= p_from and e.created_at < p_to
  group by e.product_id, p.name, p.unit;
end;
$$;

-- ============================================================
-- Stock that has not sold at all in the window.
-- ============================================================
create function public.report_dead_stock(p_days integer default 30)
returns table (
  product_id uuid,
  product_name text,
  unit product_unit,
  stock_quantity numeric,
  stock_value_cents bigint,
  last_sold_at timestamptz
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
    p.id,
    p.name,
    p.unit,
    p.stock_quantity,
    round(p.stock_quantity * p.current_cost_cents)::bigint,
    (
      select max(si.created_at)
      from sale_items si
      join sales s on s.id = si.sale_id
      where si.product_id = p.id and s.voided_at is null
    )
  from products p
  where p.active
    and p.stock_quantity > 0
    and not exists (
      select 1
      from sale_items si
      join sales s on s.id = si.sale_id
      where si.product_id = p.id
        and s.voided_at is null
        and s.created_at >= now() - make_interval(days => p_days)
    )
  order by round(p.stock_quantity * p.current_cost_cents) desc;
end;
$$;

-- ============================================================
-- What the shelves are worth right now.
-- ============================================================
create function public.report_inventory_value()
returns table (
  product_count bigint,
  unit_count numeric,
  cost_value_cents bigint,
  retail_value_cents bigint,
  potential_profit_cents bigint
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
    count(*)::bigint,
    coalesce(sum(p.stock_quantity), 0),
    coalesce(round(sum(p.stock_quantity * p.current_cost_cents)), 0)::bigint,
    coalesce(round(sum(p.stock_quantity * p.selling_price_cents)), 0)::bigint,
    coalesce(
      round(sum(p.stock_quantity * p.selling_price_cents) - sum(p.stock_quantity * p.current_cost_cents)),
      0
    )::bigint
  from products p
  where p.active and p.stock_quantity > 0;
end;
$$;

grant execute on function public.report_summary(timestamptz, timestamptz) to authenticated;
grant execute on function public.report_daily_trend(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.report_by_category(timestamptz, timestamptz) to authenticated;
grant execute on function public.report_by_hour(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.report_product_performance(timestamptz, timestamptz) to authenticated;
grant execute on function public.report_dead_stock(integer) to authenticated;
grant execute on function public.report_inventory_value() to authenticated;

-- Reports filter sales by time constantly.
create index if not exists idx_sale_items_created_at on sale_items (created_at);
create index if not exists idx_stock_adjustments_created_at on stock_adjustments (created_at);
