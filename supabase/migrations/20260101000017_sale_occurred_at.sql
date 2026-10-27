-- ============================================================
-- Sale timestamps: occurred_at vs created_at.
--
-- record_sale previously had no way to receive the time a sale actually
-- happened, so every sale synced from an offline device was stamped with
-- created_at = now() AT SYNC TIME, not when it was rung up. A whole day of
-- offline sales reconnecting in the evening landed on one minute in every
-- report, corrupting daily/hourly analysis and shift totals.
--
-- occurred_at is the real sale time, captured on the device the moment the
-- cashier completes the sale (the same value already stored as the queued
-- sale's created_at in offlineQueue.ts, now carried through to the server).
-- created_at on the sales table is UNCHANGED: it stays the time the server
-- received the row (the sync time), still useful for sync diagnostics.
-- Every report must read occurred_at instead.
--
-- BACKWARDS COMPATIBLE / ADDITIVE:
-- record_sale(p_sale_id, p_customer_id, p_payment_method, p_discount_cents,
-- p_lines) -- the 5-argument signature already in production -- is left
-- untouched below; it is not dropped or replaced. A new, separate 6-argument
-- overload adds p_occurred_at, defaulting to now(). Postgres distinguishes
-- functions by argument list, and PostgREST resolves an RPC call by the set
-- of parameter names in the request body, so the app version already in the
-- store (which POSTs the 5 old parameter names) keeps calling the old
-- function with the old behaviour -- occurred_at defaults to now(), exactly
-- like created_at did before this migration. Only an app built after this
-- ships sends p_occurred_at and reaches the new overload.
--
-- NOT BACKFILLABLE: existing sales rows carry no record of when they truly
-- occurred versus when they synced -- that information was never captured
-- and cannot be recovered after the fact. occurred_at is initialized to
-- created_at for every existing row below, which is the same (already
-- wrong, but no worse) value those rows already show today.
-- ============================================================

alter table sales add column occurred_at timestamptz not null default now();
alter table sales add column needs_clock_review boolean not null default false;

update sales set occurred_at = created_at;

create index idx_sales_occurred_at on sales (occurred_at);

-- New overload: adds p_occurred_at. The old 5-arg function below is left
-- completely untouched (see header comment) and keeps serving the app
-- version already released.
create function public.record_sale(
  p_sale_id uuid,
  p_customer_id uuid,
  p_payment_method payment_method,
  p_discount_cents bigint,
  p_lines jsonb,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
as $$
declare
  v_line jsonb;
  v_lines_total bigint;
  v_needs_review boolean;
begin
  select coalesce(
    sum(
      ((line ->> 'quantity')::numeric * (line ->> 'unit_price_cents')::bigint)::bigint
      - coalesce((line ->> 'discount_cents')::bigint, 0)
    ),
    0
  )
  into v_lines_total
  from jsonb_array_elements(p_lines) as line;

  -- A badly wrong device clock must not be able to silently inject a sale
  -- into last year's reports or next month's forecast. The sale is still
  -- recorded exactly as reported -- sale data is never discarded -- but it
  -- is flagged, and created_at (the server's own clock, via its column
  -- default) sits right next to occurred_at so the drift is visible to
  -- whoever reviews it.
  v_needs_review := p_occurred_at > now() + interval '24 hours'
    or p_occurred_at < now() - interval '30 days';

  insert into sales (
    id, cashier_id, customer_id, payment_method, discount_cents, total_cents,
    occurred_at, needs_clock_review
  )
  values (
    p_sale_id,
    auth.uid(),
    p_customer_id,
    p_payment_method,
    greatest(0, p_discount_cents),
    greatest(0, v_lines_total - greatest(0, p_discount_cents)),
    p_occurred_at,
    v_needs_review
  )
  on conflict (id) do nothing;

  -- Already recorded by an earlier attempt: return quietly, add nothing.
  if not found then
    return p_sale_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into sale_items (sale_id, product_id, quantity, unit_price_cents, discount_cents)
    values (
      p_sale_id,
      (v_line ->> 'product_id')::uuid,
      (v_line ->> 'quantity')::numeric,
      (v_line ->> 'unit_price_cents')::bigint,
      coalesce((v_line ->> 'discount_cents')::bigint, 0)
    );
  end loop;

  return p_sale_id;
end;
$$;

grant execute on function public.record_sale(uuid, uuid, payment_method, bigint, jsonb, timestamptz) to authenticated;

-- ============================================================
-- sale_line_economics: add occurred_at as a new trailing column, alongside
-- the existing created_at (sync time). Additive -- created_at is untouched,
-- so anything that already reads it from this view is unaffected.
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
)
select
  id,
  sale_id,
  product_id,
  created_at,
  occurred_at,
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
-- Reports: filter and group by occurred_at (real sale time), not
-- created_at (sync time). These are owner-only internal reporting
-- functions with a single signature each -- not something an older client
-- calls differently -- so create or replace in place is correct here,
-- unlike record_sale above.
-- ============================================================

create or replace function public.report_summary(p_from timestamptz, p_to timestamptz)
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
      and s.occurred_at >= p_from
      and s.occurred_at < p_to
  ),
  costs as (
    select coalesce(sum(e.cost_cents), 0) as cogs
    from sale_line_economics e
    where e.occurred_at >= p_from and e.occurred_at < p_to
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

create or replace function public.report_daily_trend(
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
    (e.occurred_at at time zone p_tz)::date as day,
    coalesce(sum(e.net_revenue_cents), 0)::bigint,
    coalesce(sum(e.net_revenue_cents - e.cost_cents), 0)::bigint,
    count(distinct e.sale_id)::bigint
  from sale_line_economics e
  where e.occurred_at >= p_from and e.occurred_at < p_to
  group by (e.occurred_at at time zone p_tz)::date
  order by day;
end;
$$;

create or replace function public.report_by_category(p_from timestamptz, p_to timestamptz)
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
  where e.occurred_at >= p_from and e.occurred_at < p_to
  group by p.category_id, c.name
  order by 4 desc;
end;
$$;

create or replace function public.report_by_hour(
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
    extract(hour from (e.occurred_at at time zone p_tz))::integer as hour,
    coalesce(sum(e.net_revenue_cents), 0)::bigint,
    count(distinct e.sale_id)::bigint
  from sale_line_economics e
  where e.occurred_at >= p_from and e.occurred_at < p_to
  group by 1
  order by 1;
end;
$$;

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
  where e.occurred_at >= p_from and e.occurred_at < p_to
  group by e.product_id, p.name, p.unit;
end;
$$;

create or replace function public.report_dead_stock(p_days integer default 30)
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
      select max(s.occurred_at)
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
        and s.occurred_at >= now() - make_interval(days => p_days)
    )
  order by round(p.stock_quantity * p.current_cost_cents) desc;
end;
$$;

-- report_inventory_value is untouched: it reports current stock state, not
-- anything filtered by sale time.
