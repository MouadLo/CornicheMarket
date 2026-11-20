-- Item returns (UX_REVIEW O13): hand back some of the items of a sale instead of
-- voiding all of it.
--
-- The owner records a return from the sales history. The sale itself is never
-- edited: a return is its own record (sale_returns + sale_return_items) that
-- everything else subtracts, on the day the return is MADE.
--
--   * refund per line = what the customer actually paid for it: the line total
--     after its line discount AND its share of the sale-level discount, taken
--     from sale_line_economics (the same allocation the reports use);
--   * stock goes back through a trigger, like every other stock change; the
--     average cost is left alone, exactly as void_sale leaves it (the returned
--     units carry the sale line's stamped cost for the reports);
--   * a sale with returns cannot be voided, a voided sale cannot have returns;
--   * the reports, the day close and the customer balance all subtract returns.
--
-- Dating (same principle as the day close in 037: never change a closed day):
-- a void rewrites the SALE's day, so it is refused when the sale's day is
-- closed. A return changes the day it is MADE (the refund leaves the drawer
-- today), so it is refused when TODAY is closed and is allowed on a sale from a
-- closed earlier day.
--
-- Append-only: new tables, views and functions; the functions and views that
-- already exist are replaced with the same body plus the returns terms.

-------------------------------------------------------------------------------
-- 1. Tables
-------------------------------------------------------------------------------
create table public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  reason_code text not null
    check (reason_code in ('wrong_item', 'damaged', 'customer_changed_mind', 'other')),
  note text,
  refund_method text not null check (refund_method in ('cash', 'card', 'credit')),
  refund_cents bigint not null check (refund_cents >= 0)
);
create index idx_sale_returns_sale on public.sale_returns (sale_id);
create index idx_sale_returns_created_at on public.sale_returns (created_at);

create table public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.sale_returns (id) on delete cascade,
  sale_item_id uuid not null references public.sale_items (id),
  quantity numeric(12, 3) not null check (quantity > 0),
  refund_cents bigint not null check (refund_cents >= 0),
  -- The sale line's stamped cost, copied so the reports can take the cost of
  -- the returned units back out. Never readable by a cashier.
  unit_cost_cents bigint not null check (unit_cost_cents >= 0)
);
create index idx_sale_return_items_return on public.sale_return_items (return_id);
create index idx_sale_return_items_line on public.sale_return_items (sale_item_id);

alter table public.sale_returns enable row level security;
alter table public.sale_return_items enable row level security;

-- The owner reads every return; a cashier only the returns of their own sales
-- (so their history can say "1 item returned"). Nobody writes directly: the
-- only writer is record_sale_return.
create policy sale_returns_owner_read on public.sale_returns
  for select using (public.is_owner());
create policy sale_returns_own_read on public.sale_returns
  for select using (
    exists (select 1 from public.sales s where s.id = sale_id and s.cashier_id = auth.uid())
  );
-- The items table carries the cost: owner only. A cashier reads the view below.
create policy sale_return_items_owner_read on public.sale_return_items
  for select using (public.is_owner());

revoke all on public.sale_returns, public.sale_return_items from public, anon, authenticated;
grant select on public.sale_returns to authenticated;
grant select on public.sale_return_items to authenticated;

-- Same idea as sale_items_cashier_view: no cost column, only the caller's own
-- sales (the owner sees all).
create view public.sale_return_items_cashier_view
  with (security_barrier = true)
as
select
  ri.id, ri.return_id, sr.sale_id, ri.sale_item_id, ri.quantity, ri.refund_cents, sr.created_at
from public.sale_return_items ri
join public.sale_returns sr on sr.id = ri.return_id
join public.sales s on s.id = sr.sale_id
where s.cashier_id = auth.uid() or public.is_owner();

revoke all on public.sale_return_items_cashier_view from public, anon, authenticated;
grant select on public.sale_return_items_cashier_view to authenticated;

-------------------------------------------------------------------------------
-- 2. Stock goes back through a trigger (the fifth stock trigger)
-------------------------------------------------------------------------------
-- Like void_sale: quantity back on the shelf, nothing for untracked items
-- (Divers), the weighted-average cost untouched.
create function public.apply_sale_return_item_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.products p
  set stock_quantity = p.stock_quantity + new.quantity
  from public.sale_items si
  where si.id = new.sale_item_id
    and p.id = si.product_id
    and p.track_stock;
  return new;
end;
$$;

create trigger trg_sale_return_items_after_insert
  after insert on public.sale_return_items
  for each row execute function public.apply_sale_return_item_stock();

revoke execute on function public.apply_sale_return_item_stock() from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 3. A sale with returns cannot be voided (whatever the path)
-------------------------------------------------------------------------------
create function public.guard_void_sale_with_returns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.voided_at is null and new.voided_at is not null
     and exists (select 1 from public.sale_returns where sale_id = old.id) then
    raise exception 'This sale has returns and cannot be voided' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger trg_sales_void_with_returns
  before update of voided_at on public.sales
  for each row execute function public.guard_void_sale_with_returns();

-- A cashier's void request for such a sale is refused when it is made, not left
-- pending until the owner's approval fails.
create function public.guard_void_request_with_returns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.sale_returns where sale_id = new.sale_id) then
    raise exception 'This sale has returns and cannot be voided' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger trg_void_requests_with_returns
  before insert on public.void_requests
  for each row execute function public.guard_void_request_with_returns();

revoke execute on function public.guard_void_sale_with_returns() from public, anon, authenticated;
revoke execute on function public.guard_void_request_with_returns() from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 4. Reading what can still be returned (owner only)
-------------------------------------------------------------------------------
-- The refund of a line depends on how the sale-level discount was allocated
-- (sale_line_economics), which a device cannot work out on its own. This gives
-- the return sheet exactly what the server will use.
create function public.returnable_sale_lines(p_sale_id uuid)
returns table (
  sale_item_id uuid,
  quantity numeric,
  returned_quantity numeric,
  paid_cents bigint,
  refunded_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Only an owner can return items' using errcode = '42501';
  end if;

  return query
  select
    e.id,
    e.quantity,
    coalesce(r.quantity, 0),
    e.net_revenue_cents,
    coalesce(r.refund_cents, 0)::bigint
  from public.sale_line_economics e
  left join (
    select ri.sale_item_id, sum(ri.quantity) as quantity, sum(ri.refund_cents) as refund_cents
    from public.sale_return_items ri
    group by ri.sale_item_id
  ) r on r.sale_item_id = e.id
  where e.sale_id = p_sale_id;
end;
$$;

revoke execute on function public.returnable_sale_lines(uuid) from public, anon;
grant execute on function public.returnable_sale_lines(uuid) to authenticated;

-------------------------------------------------------------------------------
-- 5. Recording a return
-------------------------------------------------------------------------------
-- p_items: [{"sale_item_id": uuid, "quantity": number}, ...]. Amounts are never
-- taken from the client.
--
-- Refund of a line (rounding rule): with P = what was paid for the whole line
-- (line total - line discount - its share of the sale discount), Q the quantity
-- sold, R and F the quantity and money already returned/refunded on it, and q
-- the quantity returned now:
--     refund = round(P * (R + q) / Q) - F          (round half up, centimes)
-- and when R + q = Q the refund is exactly P - F. So the refunds of one line
-- always add up to P, never above it: the last unit takes the remainder.
--
-- Idempotent on p_return_id: replaying the same return changes nothing.
create function public.record_sale_return(
  p_return_id uuid,
  p_sale_id uuid,
  p_items jsonb,
  p_reason_code text,
  p_note text,
  p_refund_method text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_note text := nullif(btrim(p_note), '');
  v_sale public.sales%rowtype;
  v_existing public.sale_returns%rowtype;
  v_item jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_seen uuid[] := '{}';
  v_line_id uuid;
  v_qty numeric;
  v_sold numeric;
  v_paid bigint;
  v_cost bigint;
  v_returned numeric;
  v_refunded bigint;
  v_refund bigint;
  v_total bigint := 0;
begin
  if not public.is_owner() then
    raise exception 'Only an owner can return items' using errcode = '42501';
  end if;

  if p_return_id is null or p_sale_id is null
     or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A return needs at least one line' using errcode = '22023';
  end if;
  if p_reason_code is null
     or p_reason_code not in ('wrong_item', 'damaged', 'customer_changed_mind', 'other') then
    raise exception 'Unknown reason' using errcode = '22023';
  end if;
  if p_reason_code = 'other' and v_note is null then
    raise exception 'A note is required for this reason' using errcode = '22023';
  end if;
  if p_refund_method is null or p_refund_method not in ('cash', 'card', 'credit') then
    raise exception 'Unknown refund method' using errcode = '22023';
  end if;

  -- Lock the sale: two returns (or a return and a void) of one sale are
  -- serialised, so the remaining quantities below cannot go stale.
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale not found' using errcode = 'P0002';
  end if;

  -- Already recorded by an earlier attempt: add nothing, log nothing.
  select * into v_existing from public.sale_returns where id = p_return_id;
  if found then
    if v_existing.sale_id <> p_sale_id then
      raise exception 'This return id is already used for another sale' using errcode = '22023';
    end if;
    return p_return_id;
  end if;

  if v_sale.voided_at is not null then
    raise exception 'This sale is already voided' using errcode = '22023';
  end if;

  -- A refund is paid today, so it is refused when today is closed.
  if exists (select 1 from public.day_closes where day = public.store_day(now())) then
    raise exception 'The day is closed' using errcode = 'P0001';
  end if;

  -- A credit sale is repaid on the customer's account, never in cash or card;
  -- a cash or card sale is refunded in cash or card.
  if (v_sale.payment_method = 'credit') <> (p_refund_method = 'credit') then
    raise exception 'That refund method does not fit this sale' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_line_id := (v_item ->> 'sale_item_id')::uuid;
    v_qty := (v_item ->> 'quantity')::numeric;

    if v_line_id is null or v_qty is null or v_qty <= 0 or v_qty <> round(v_qty, 3) then
      raise exception 'Each returned line needs a quantity above 0' using errcode = '22023';
    end if;
    if v_line_id = any (v_seen) then
      raise exception 'A line can only appear once in a return' using errcode = '22023';
    end if;
    v_seen := v_seen || v_line_id;

    -- What was paid for the whole line, from the same allocation the reports use.
    select e.quantity, e.net_revenue_cents, si.unit_cost_cents
    into v_sold, v_paid, v_cost
    from public.sale_line_economics e
    join public.sale_items si on si.id = e.id
    where e.id = v_line_id and e.sale_id = p_sale_id;
    if not found then
      raise exception 'That line is not part of this sale' using errcode = '22023';
    end if;

    select coalesce(sum(ri.quantity), 0), coalesce(sum(ri.refund_cents), 0)
    into v_returned, v_refunded
    from public.sale_return_items ri
    where ri.sale_item_id = v_line_id;

    if v_qty > v_sold - v_returned then
      raise exception 'Cannot return more than was sold' using errcode = '22023';
    end if;

    if v_returned + v_qty = v_sold then
      v_refund := v_paid - v_refunded;
    else
      v_refund := round(v_paid::numeric * (v_returned + v_qty) / v_sold)::bigint - v_refunded;
    end if;
    v_refund := greatest(0, least(v_refund, v_paid - v_refunded));

    v_total := v_total + v_refund;
    v_rows := v_rows || jsonb_build_object(
      'sale_item_id', v_line_id,
      'quantity', v_qty,
      'refund_cents', v_refund,
      'unit_cost_cents', v_cost
    );
  end loop;

  insert into public.sale_returns (id, sale_id, created_by, reason_code, note, refund_method, refund_cents)
  values (p_return_id, p_sale_id, v_actor, p_reason_code, v_note, p_refund_method, v_total);

  insert into public.sale_return_items (return_id, sale_item_id, quantity, refund_cents, unit_cost_cents)
  select
    p_return_id,
    (r ->> 'sale_item_id')::uuid,
    (r ->> 'quantity')::numeric,
    (r ->> 'refund_cents')::bigint,
    (r ->> 'unit_cost_cents')::bigint
  from jsonb_array_elements(v_rows) as r;

  insert into public.activity_log (actor_id, action, entity_id, details)
  values (
    v_actor,
    'sale_returned',
    p_sale_id,
    jsonb_build_object(
      'sale_id', p_sale_id,
      'return_id', p_return_id,
      'refund_cents', v_total,
      'refund_method', p_refund_method,
      'item_count', jsonb_array_length(v_rows),
      'reason_code', p_reason_code
    )
  );

  return p_return_id;
end;
$$;

revoke execute on function public.record_sale_return(uuid, uuid, jsonb, text, text, text)
  from public, anon;
grant execute on function public.record_sale_return(uuid, uuid, jsonb, text, text, text)
  to authenticated;

-------------------------------------------------------------------------------
-- 6. Reports: one row per returned line, mirror of sale_line_economics
-------------------------------------------------------------------------------
-- net_revenue_cents is what was refunded; cost_cents is the stamped cost of the
-- returned units (round(unit cost x quantity), as sale_line_economics does for
-- a sold line). Both are subtracted by the report functions below, on the day
-- of the return (returned_at).
create view public.sale_return_economics as
select
  ri.id,
  sr.sale_id,
  si.product_id,
  sr.created_at as returned_at,
  ri.quantity,
  ri.refund_cents as net_revenue_cents,
  round(ri.unit_cost_cents * ri.quantity)::bigint as cost_cents
from public.sale_return_items ri
join public.sale_returns sr on sr.id = ri.return_id
join public.sale_items si on si.id = ri.sale_item_id
where public.is_owner();

revoke all on public.sale_return_economics from public, anon, authenticated;
grant select on public.sale_return_economics to authenticated;

-- report_summary: same as 017, minus returns; one more column (returns_cents:
-- what was refunded in the range) so a new column means drop + create.
drop function if exists public.report_summary(timestamptz, timestamptz);

create function public.report_summary(p_from timestamptz, p_to timestamptz)
returns table (
  revenue_cents bigint,
  cogs_cents bigint,
  gross_profit_cents bigint,
  margin_percent numeric,
  transaction_count bigint,
  average_basket_cents bigint,
  loss_cents bigint,
  returns_cents bigint
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
  returned as (
    -- Refunds made in the range, whenever the sale itself was rung up.
    select
      coalesce(sum(r.net_revenue_cents), 0) as refunded,
      coalesce(sum(r.cost_cents), 0) as returned_cost
    from sale_return_economics r
    where r.returned_at >= p_from and r.returned_at < p_to
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
      (coalesce(sum(sir.total_cents), 0) - (select rt.refunded from returned rt))::bigint as revenue,
      count(*)::bigint as txn
    from sales_in_range sir
  )
  select
    t.revenue,
    (c.cogs - rt.returned_cost)::bigint,
    (t.revenue - (c.cogs - rt.returned_cost))::bigint,
    case when t.revenue > 0
      then round((t.revenue - (c.cogs - rt.returned_cost))::numeric * 100 / t.revenue, 2)
      else null
    end,
    t.txn,
    case when t.txn > 0 then round(t.revenue::numeric / t.txn)::bigint else 0 end,
    round(l.lost)::bigint,
    rt.refunded::bigint
  from totals t, costs c, returned rt, losses l;
end;
$$;

grant execute on function public.report_summary(timestamptz, timestamptz) to authenticated;

-- report_daily_trend: same as 021, plus a negative row per returned line on the
-- day of the return (a return is not a sale: it adds no transaction).
create or replace function public.report_daily_trend(
  p_from timestamptz,
  p_to timestamptz
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
declare
  v_tz text := public.store_timezone();
begin
  if not public.is_owner() then
    raise exception 'Reports are owner only';
  end if;

  return query
  with moves as (
    select
      (e.occurred_at at time zone v_tz)::date as d,
      e.net_revenue_cents as rev,
      e.net_revenue_cents - e.cost_cents as prof,
      e.sale_id as sale_id
    from sale_line_economics e
    where e.occurred_at >= p_from and e.occurred_at < p_to
    union all
    select
      (r.returned_at at time zone v_tz)::date,
      -r.net_revenue_cents,
      -(r.net_revenue_cents - r.cost_cents),
      null::uuid
    from sale_return_economics r
    where r.returned_at >= p_from and r.returned_at < p_to
  )
  select
    m.d,
    coalesce(sum(m.rev), 0)::bigint,
    coalesce(sum(m.prof), 0)::bigint,
    count(distinct m.sale_id)::bigint
  from moves m
  group by m.d
  order by m.d;
end;
$$;

-- report_by_category: same as 036 (sub-categories roll up into their parent),
-- minus the returned quantities, revenue and profit.
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
    coalesce(top.id, p.category_id),
    coalesce(top.name, 'Uncategorised') as category_name,
    coalesce(sum(m.qty), 0),
    coalesce(sum(m.rev), 0)::bigint,
    coalesce(sum(m.rev - m.cost), 0)::bigint
  from moves m
  join products p on p.id = m.product_id
  left join categories c on c.id = p.category_id
  left join categories top on top.id = coalesce(c.parent_id, c.id)
  group by coalesce(top.id, p.category_id), top.name
  order by 4 desc;
end;
$$;

-- report_by_hour: same as 021, minus the refunds in the hour they were made.
create or replace function public.report_by_hour(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  hour integer,
  revenue_cents bigint,
  transaction_count bigint
)
language plpgsql
stable
as $$
declare
  v_tz text := public.store_timezone();
begin
  if not public.is_owner() then
    raise exception 'Reports are owner only';
  end if;

  return query
  with moves as (
    select
      extract(hour from (e.occurred_at at time zone v_tz))::integer as h,
      e.net_revenue_cents as rev,
      e.sale_id as sale_id
    from sale_line_economics e
    where e.occurred_at >= p_from and e.occurred_at < p_to
    union all
    select
      extract(hour from (r.returned_at at time zone v_tz))::integer,
      -r.net_revenue_cents,
      null::uuid
    from sale_return_economics r
    where r.returned_at >= p_from and r.returned_at < p_to
  )
  select
    m.h,
    coalesce(sum(m.rev), 0)::bigint,
    count(distinct m.sale_id)::bigint
  from moves m
  group by 1
  order by 1;
end;
$$;

-- report_product_performance: same as 017, minus returned quantity, revenue and
-- profit (cost of the returned units comes back out).
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
  group by m.product_id, p.name, p.unit;
end;
$$;

-- product_sales_30d (reorder suggestions): same as 013, with the quantity
-- returned in the last 30 days taken off.
create or replace view product_sales_30d as
select
  x.product_id,
  sum(x.quantity) as quantity_sold,
  count(distinct x.sale_id) as sale_count
from (
  select si.product_id as product_id, si.quantity as quantity, s.id as sale_id
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.voided_at is null
    and s.created_at >= now() - interval '30 days'
  union all
  select si.product_id, -ri.quantity, null::uuid
  from sale_return_items ri
  join sale_returns sr on sr.id = ri.return_id
  join sale_items si on si.id = ri.sale_item_id
  where sr.created_at >= now() - interval '30 days'
) x
group by x.product_id;

-------------------------------------------------------------------------------
-- 7. customer_balances: a credit return lowers what the customer owes
-------------------------------------------------------------------------------
-- Same body and columns as 043 (create or replace view can only append columns,
-- so nothing is appended). The only change: the credit side is net of the
-- refunds recorded on the account, so balance = credit - returns - payments.
create or replace view public.customer_balances as
select
  c.id,
  c.name,
  c.phone,
  coalesce(credit.total, 0)::bigint as credit_total_cents,
  coalesce(paid.total, 0)::bigint as paid_total_cents,
  (coalesce(credit.total, 0) - coalesce(paid.total, 0))::bigint as balance_cents,
  public.customer_credit_limit(c.id) as credit_limit_cents,
  greatest(
    public.customer_credit_limit(c.id) - (coalesce(credit.total, 0) - coalesce(paid.total, 0)),
    0
  )::bigint as credit_available_cents,
  c.credit_limit_cents as credit_limit_override_cents
from public.customers c
left join (
  select s.customer_id, sum(s.total_cents) - coalesce(sum(r.refund_cents), 0) as total
  from public.sales s
  left join (
    select sr.sale_id, sum(sr.refund_cents) as refund_cents
    from public.sale_returns sr
    where sr.refund_method = 'credit'
    group by sr.sale_id
  ) r on r.sale_id = s.id
  where s.payment_method = 'credit' and s.voided_at is null and s.customer_id is not null
  group by s.customer_id
) credit on credit.customer_id = c.id
left join (
  select customer_id, sum(amount_cents) as total
  from public.customer_payments
  group by customer_id
) paid on paid.customer_id = c.id;

-------------------------------------------------------------------------------
-- 8. Day close: refunds made that day come out of the drawer
-------------------------------------------------------------------------------
-- Snapshot columns (defaults keep the days already closed valid).
alter table public.day_closes
  add column cash_refunds_cents bigint not null default 0,
  add column card_refunds_cents bigint not null default 0,
  add column credit_refunds_cents bigint not null default 0;

-- day_summary: same as 037, plus the day's refunds per cashier. A refund is
-- booked to the cashier who rang the sale up (like a void) and dated by when
-- the return was made. A cashier sees the refunds of their own sales only.
create or replace function public.day_summary(p_day date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_owner boolean := public.is_owner();
  v_rows jsonb;
  v_close public.day_closes%rowtype;
  v_suggested bigint;
  v_day date := coalesce(p_day, public.store_day(now()));
begin
  if v_actor is null or not exists (
    select 1 from public.profiles where id = v_actor and role in ('owner', 'cashier')
  ) then
    raise exception 'Authenticated staff required' using errcode = '42501';
  end if;

  with sale_rows as (
    select s.cashier_id,
      count(*) filter (where s.voided_at is null) as sales_count,
      coalesce(sum(s.total_cents) filter (where s.voided_at is null and s.payment_method = 'cash'), 0) as cash_cents,
      coalesce(sum(s.total_cents) filter (where s.voided_at is null and s.payment_method = 'card'), 0) as card_cents,
      coalesce(sum(s.total_cents) filter (where s.voided_at is null and s.payment_method = 'credit'), 0) as credit_cents,
      coalesce(sum(s.discount_cents) filter (where s.voided_at is null), 0) as discount_cents,
      count(*) filter (where s.voided_at is not null) as voids_count,
      coalesce(sum(s.total_cents) filter (where s.voided_at is not null), 0) as voids_cents
    from public.sales s
    where public.store_day(s.occurred_at) = v_day
      and (v_owner or s.cashier_id = v_actor)
    group by s.cashier_id
  ),
  pay_rows as (
    select cp.created_by as cashier_id,
      coalesce(sum(cp.amount_cents) filter (where cp.method = 'cash'), 0) as cash_payments_cents,
      coalesce(sum(cp.amount_cents) filter (where cp.method = 'card'), 0) as card_payments_cents
    from public.customer_payments cp
    where public.store_day(cp.created_at) = v_day
      and (v_owner or cp.created_by = v_actor)
    group by cp.created_by
  ),
  ref_rows as (
    select s.cashier_id,
      count(*) as refunds_count,
      coalesce(sum(sr.refund_cents) filter (where sr.refund_method = 'cash'), 0) as cash_refunds_cents,
      coalesce(sum(sr.refund_cents) filter (where sr.refund_method = 'card'), 0) as card_refunds_cents,
      coalesce(sum(sr.refund_cents) filter (where sr.refund_method = 'credit'), 0) as credit_refunds_cents
    from public.sale_returns sr
    join public.sales s on s.id = sr.sale_id
    where public.store_day(sr.created_at) = v_day
      and (v_owner or s.cashier_id = v_actor)
    group by s.cashier_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'cashier_id', p.id,
      'cashier_name', p.full_name,
      'sales_count', coalesce(sr.sales_count, 0),
      'cash_cents', coalesce(sr.cash_cents, 0),
      'card_cents', coalesce(sr.card_cents, 0),
      'credit_cents', coalesce(sr.credit_cents, 0),
      'discount_cents', coalesce(sr.discount_cents, 0),
      'voids_count', coalesce(sr.voids_count, 0),
      'voids_cents', coalesce(sr.voids_cents, 0),
      'cash_payments_cents', coalesce(pr.cash_payments_cents, 0),
      'card_payments_cents', coalesce(pr.card_payments_cents, 0),
      'refunds_count', coalesce(rr.refunds_count, 0),
      'cash_refunds_cents', coalesce(rr.cash_refunds_cents, 0),
      'card_refunds_cents', coalesce(rr.card_refunds_cents, 0),
      'credit_refunds_cents', coalesce(rr.credit_refunds_cents, 0)
    ) order by p.full_name), '[]'::jsonb)
  into v_rows
  from public.profiles p
  left join sale_rows sr on sr.cashier_id = p.id
  left join pay_rows pr on pr.cashier_id = p.id
  left join ref_rows rr on rr.cashier_id = p.id
  where (sr.cashier_id is not null or pr.cashier_id is not null or rr.cashier_id is not null);

  select * into v_close from public.day_closes where day = v_day;

  if v_owner then
    select leave_in_drawer_cents into v_suggested
    from public.day_closes where day < v_day order by day desc limit 1;
  end if;

  return jsonb_build_object(
    'day', v_day,
    'closed', v_close.day is not null,
    'cashiers', v_rows,
    'close', case when v_owner and v_close.day is not null then to_jsonb(v_close) else null end,
    'suggested_float_cents', coalesce(v_suggested, 0),
    'today', public.store_day(now())
  );
end;
$$;

-- close_day: same as 037; the expected cash also loses the day's cash refunds,
-- and the refunds are snapshotted with the rest.
create or replace function public.close_day(
  p_day date,
  p_opening_float_cents bigint,
  p_counted_cash_cents bigint,
  p_leave_in_drawer_cents bigint,
  p_note text default null
)
returns public.day_closes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.day_closes%rowtype;
  v_sales record;
  v_pay record;
  v_ref record;
begin
  if not public.is_owner() then
    raise exception 'Only an owner can close the day' using errcode = '42501';
  end if;
  if p_day is null or p_day > public.store_day(now()) then
    raise exception 'A day that has not happened yet cannot be closed' using errcode = '22023';
  end if;
  if p_opening_float_cents is null or p_opening_float_cents < 0
     or p_counted_cash_cents is null or p_counted_cash_cents < 0
     or p_leave_in_drawer_cents is null or p_leave_in_drawer_cents < 0 then
    raise exception 'Amounts cannot be negative' using errcode = '22023';
  end if;
  if exists (select 1 from public.day_closes where day = p_day) then
    raise exception 'This day is already closed' using errcode = '23505';
  end if;

  select
    count(*) filter (where voided_at is null) as sales_count,
    coalesce(sum(total_cents) filter (where voided_at is null and payment_method = 'cash'), 0) as cash_cents,
    coalesce(sum(total_cents) filter (where voided_at is null and payment_method = 'card'), 0) as card_cents,
    coalesce(sum(total_cents) filter (where voided_at is null and payment_method = 'credit'), 0) as credit_cents,
    coalesce(sum(discount_cents) filter (where voided_at is null), 0) as discount_cents,
    count(*) filter (where voided_at is not null) as voids_count,
    coalesce(sum(total_cents) filter (where voided_at is not null), 0) as voids_cents
  into v_sales
  from public.sales
  where public.store_day(occurred_at) = p_day;

  select
    coalesce(sum(amount_cents) filter (where method = 'cash'), 0) as cash_cents,
    coalesce(sum(amount_cents) filter (where method = 'card'), 0) as card_cents
  into v_pay
  from public.customer_payments
  where public.store_day(created_at) = p_day;

  select
    coalesce(sum(refund_cents) filter (where refund_method = 'cash'), 0) as cash_cents,
    coalesce(sum(refund_cents) filter (where refund_method = 'card'), 0) as card_cents,
    coalesce(sum(refund_cents) filter (where refund_method = 'credit'), 0) as credit_cents
  into v_ref
  from public.sale_returns
  where public.store_day(created_at) = p_day;

  insert into public.day_closes (
    day, opening_float_cents, expected_cash_cents, counted_cash_cents, leave_in_drawer_cents,
    sales_count, cash_sales_cents, card_sales_cents, credit_sales_cents,
    cash_payments_cents, card_payments_cents, discounts_cents, voids_count, voids_cents,
    cash_refunds_cents, card_refunds_cents, credit_refunds_cents,
    note, closed_by
  )
  values (
    p_day, p_opening_float_cents,
    p_opening_float_cents + v_sales.cash_cents + v_pay.cash_cents - v_ref.cash_cents,
    p_counted_cash_cents, p_leave_in_drawer_cents,
    v_sales.sales_count, v_sales.cash_cents, v_sales.card_cents, v_sales.credit_cents,
    v_pay.cash_cents, v_pay.card_cents, v_sales.discount_cents, v_sales.voids_count, v_sales.voids_cents,
    v_ref.cash_cents, v_ref.card_cents, v_ref.credit_cents,
    nullif(btrim(p_note), ''), v_actor
  )
  returning * into v_row;

  return v_row;
end;
$$;


-------------------------------------------------------------------------------
-- record_sale: the customer debt-limit review (043) now subtracts credit refunds
-- from the balance before the sale, matching customer_balances. Otherwise a
-- customer who returned items bought on credit would be flagged as over their
-- limit while the device (which reads customer_balances) correctly allows it.
-- The body is migration 043's, unchanged apart from that one term.
-------------------------------------------------------------------------------
create or replace function public.record_sale(
  p_sale_id uuid,
  p_customer_id uuid,
  p_payment_method public.payment_method,
  p_discount_cents bigint,
  p_lines jsonb,
  p_occurred_at timestamptz,
  p_expected_cashier uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_line jsonb;
  v_lines_total bigint;
  v_needs_review boolean;
  v_line_subtotal bigint;
  v_line_discount bigint;
  v_mismatches jsonb;
  v_pct numeric;
  v_discount_lines jsonb;
  v_sale_discount jsonb;
  v_kind text;
  v_note text;
  v_divers_max bigint;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles where id = v_actor and role in ('owner', 'cashier')
  ) then
    raise exception 'Authenticated staff required' using errcode = '42501';
  end if;

  -- An ASSERTION, never a claim. The sale is always credited to the caller's own
  -- session (v_actor); this only lets a device say "this was rung up by X" so a
  -- sync that lands on the wrong account (someone signed in meanwhile) is refused
  -- instead of silently recorded under that account (audit C05). Nothing a client
  -- sends can make a sale be credited to anyone but the caller.
  if p_expected_cashier is not null and p_expected_cashier <> v_actor then
    raise exception 'This sale was rung up by another user' using errcode = '42501';
  end if;

  if p_sale_id is null or p_payment_method is null
     or p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A sale needs at least one line' using errcode = '22023';
  end if;

  if p_payment_method = 'credit' and p_customer_id is null then
    raise exception 'A credit sale needs a customer' using errcode = '22023';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) as line
  loop
    v_line_subtotal := round(
      (v_line ->> 'quantity')::numeric * (v_line ->> 'unit_price_cents')::bigint
    );
    v_line_discount := coalesce((v_line ->> 'discount_cents')::bigint, 0);

    if v_line_discount < 0 or v_line_discount > v_line_subtotal then
      raise exception 'A line discount cannot exceed that line''s price';
    end if;

    -- Divers (the built-in free-amount item): one at a time, within the owner's
    -- maximum, with a short note. Checked here as well as on the pad, because an
    -- offline device may hold an older limit or a hand-built payload.
    select kind into v_kind from public.products where id = (v_line ->> 'product_id')::uuid;
    if v_kind = 'misc' then
      select divers_max_cents into v_divers_max from public.store_settings limit 1;
      if (v_line ->> 'quantity')::numeric <> 1 then
        raise exception 'A Divers line is always quantity 1' using errcode = '22023';
      end if;
      if (v_line ->> 'unit_price_cents')::bigint <= 0
         or (v_line ->> 'unit_price_cents')::bigint > coalesce(v_divers_max, 20000) then
        raise exception 'A Divers amount must be above 0 and within the maximum' using errcode = '22023';
      end if;
      if char_length(coalesce(btrim(v_line ->> 'note'), '')) > 60 then
        raise exception 'A Divers note is at most 60 characters' using errcode = '22023';
      end if;
    end if;
  end loop;

  select coalesce(
    sum(
      ((line ->> 'quantity')::numeric * (line ->> 'unit_price_cents')::bigint)::bigint
      - coalesce((line ->> 'discount_cents')::bigint, 0)
    ),
    0
  )
  into v_lines_total
  from jsonb_array_elements(p_lines) as line;

  if p_discount_cents < 0 or p_discount_cents > v_lines_total then
    raise exception 'The sale discount cannot exceed the basket total';
  end if;

  v_needs_review := p_occurred_at > now() + interval '24 hours'
    or p_occurred_at < now() - interval '30 days';

  insert into public.sales (
    id, cashier_id, customer_id, payment_method, discount_cents, total_cents,
    occurred_at, needs_clock_review
  )
  values (
    p_sale_id,
    v_actor,
    p_customer_id,
    p_payment_method,
    p_discount_cents,
    v_lines_total - p_discount_cents,
    p_occurred_at,
    v_needs_review
  )
  on conflict (id) do nothing;

  -- Already recorded by an earlier attempt (offline retry): add nothing, log nothing.
  if not found then
    return p_sale_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    -- A note is kept for Divers lines only; the cost of a Divers line is
    -- estimated by the stamp trigger, never taken from the payload.
    select kind into v_kind from public.products where id = (v_line ->> 'product_id')::uuid;
    v_note := case when v_kind = 'misc' then nullif(btrim(v_line ->> 'note'), '') end;
    insert into public.sale_items (sale_id, product_id, quantity, unit_price_cents, discount_cents, note)
    values (
      p_sale_id,
      (v_line ->> 'product_id')::uuid,
      (v_line ->> 'quantity')::numeric,
      (v_line ->> 'unit_price_cents')::bigint,
      coalesce((v_line ->> 'discount_cents')::bigint, 0),
      v_note
    );
  end loop;

  -- Price review. Never allowed to fail the sale: money has already changed
  -- hands, and an offline sale cannot be un-rung. An error in here is turned
  -- into a warning and the sale stays recorded.
  begin
    select jsonb_agg(
             jsonb_build_object(
               'product_id', c.product_id,
               'product_name', pr.name,
               'quantity', c.quantity,
               'device_price_cents', c.device_price,
               'expected_price_cents', c.expected,
               'matches_previous_price', c.previous is not null and c.device_price = c.previous
             )
             order by c.ord
           )
      into v_mismatches
    from (
      select
        l.ord,
        l.product_id,
        l.quantity,
        l.device_price,
        sp.effective_cents as expected,
        sp.previous_cents as previous
      from (
        select ord,
               (line ->> 'product_id')::uuid as product_id,
               (line ->> 'quantity')::numeric as quantity,
               (line ->> 'unit_price_cents')::bigint as device_price
        from jsonb_array_elements(p_lines) with ordinality as t(line, ord)
      ) l
      cross join lateral public.selling_price_at(l.product_id, p_occurred_at) sp
    ) c
    join public.products pr on pr.id = c.product_id
    -- Divers has no list price to be wrong about.
    where pr.kind <> 'misc'
      and c.expected is not null and c.device_price is distinct from c.expected;

    if v_mismatches is not null then
      update public.sales set needs_price_review = true where id = p_sale_id;
      insert into public.activity_log (actor_id, action, entity_id, details)
      values (
        v_actor,
        'price_mismatch',
        p_sale_id,
        jsonb_build_object(
          'sale_id', p_sale_id,
          'occurred_at', p_occurred_at,
          'lines', v_mismatches
        )
      );
    end if;
  exception when others then
    raise warning 'price review skipped for sale %: %', p_sale_id, sqlerrm;
  end;

  -- Discount review: same rules, own block, so neither check can skip the
  -- other and neither can fail the sale. "Exceeds" is strict: a discount of
  -- exactly the threshold is fine. Comparisons stay in integers/numerics.
  begin
    select discount_review_percent into v_pct from public.owner_settings where singleton;
    v_pct := coalesce(v_pct, 10);

    select jsonb_agg(
             jsonb_build_object(
               'product_id', l.product_id,
               'product_name', pr.name,
               'line_amount_cents', l.amount,
               'discount_cents', l.discount,
               'percent', round(l.discount * 100.0 / l.amount, 2)
             )
             order by l.ord
           )
      into v_discount_lines
    from (
      select ord,
             (line ->> 'product_id')::uuid as product_id,
             round((line ->> 'quantity')::numeric * (line ->> 'unit_price_cents')::bigint)::bigint as amount,
             coalesce((line ->> 'discount_cents')::bigint, 0) as discount
      from jsonb_array_elements(p_lines) with ordinality as t(line, ord)
    ) l
    join public.products pr on pr.id = l.product_id
    where l.amount > 0 and l.discount * 100 > v_pct * l.amount;

    if p_discount_cents > 0 and v_lines_total > 0
       and p_discount_cents * 100 > v_pct * v_lines_total then
      v_sale_discount := jsonb_build_object(
        'discount_cents', p_discount_cents,
        'basket_cents', v_lines_total,
        'percent', round(p_discount_cents * 100.0 / v_lines_total, 2)
      );
    end if;

    if v_discount_lines is not null or v_sale_discount is not null then
      update public.sales set needs_discount_review = true where id = p_sale_id;
      insert into public.activity_log (actor_id, action, entity_id, details)
      values (
        v_actor,
        'discount_over_threshold',
        p_sale_id,
        jsonb_build_object(
          'sale_id', p_sale_id,
          'occurred_at', p_occurred_at,
          'threshold_percent', v_pct,
          'lines', coalesce(v_discount_lines, '[]'::jsonb),
          'sale_discount', v_sale_discount
        )
      );
    end if;
  exception when others then
    raise warning 'discount review skipped for sale %: %', p_sale_id, sqlerrm;
  end;

  -- Cashier discount limit (migration 041). A third review, own block, never
  -- allowed to fail the sale: the DEVICE enforces the limit, the server only
  -- flags a breach for the owner. Skipped for the owner, who has no limit.
  -- Works on the stamped sale_items (discountable is set by the insert trigger,
  -- never by the payload).
  declare
    v_percent numeric;
    v_max bigint;
    v_gross bigint;
    v_limit bigint;
    v_total_discount bigint;
    v_blocked jsonb;
  begin
    if not exists (select 1 from public.profiles where id = v_actor and role = 'owner') then
      select cashier_discount_percent, cashier_discount_max_cents
        into v_percent, v_max
      from public.store_settings limit 1;
      v_percent := coalesce(v_percent, 5);
      v_max := coalesce(v_max, 2000);

      select coalesce(sum(round(quantity * unit_price_cents)::bigint) filter (where discountable), 0),
             coalesce(sum(discount_cents), 0)
        into v_gross, v_total_discount
      from public.sale_items
      where sale_id = p_sale_id;

      v_total_discount := v_total_discount + p_discount_cents;
      v_limit := least(floor(v_percent * v_gross / 100)::bigint, v_max);

      select jsonb_agg(
               jsonb_build_object('product_id', product_id, 'discount_cents', discount_cents)
               order by created_at, id
             )
        into v_blocked
      from public.sale_items
      where sale_id = p_sale_id and not discountable and discount_cents > 0;

      if v_total_discount > v_limit or v_blocked is not null then
        update public.sales set needs_discount_review = true where id = p_sale_id;
        insert into public.activity_log (actor_id, action, entity_id, details)
        values (
          v_actor,
          'discount_over_cashier_limit',
          p_sale_id,
          jsonb_build_object(
            'sale_id', p_sale_id,
            'occurred_at', p_occurred_at,
            'limit_cents', v_limit,
            'total_discount_cents', v_total_discount,
            'percent', v_percent,
            'max_cents', v_max,
            'blocked_lines', coalesce(v_blocked, '[]'::jsonb)
          )
        );
      end if;
    end if;
  exception when others then
    raise warning 'cashier discount review skipped for sale %: %', p_sale_id, sqlerrm;
  end;

  -- Customer debt limit (migration 043). A fourth review, own block, never
  -- allowed to fail the sale: the DEVICE enforces the limit, the server only
  -- flags a breach for the owner. Skipped for the owner, who has no limit and
  -- for anything but a credit sale. An idempotent replay never gets here (it
  -- returned above), so a sale is judged once.
  --
  -- The balance BEFORE this sale is the customer_balances definition (credit
  -- sales not voided, minus payments) with this sale's own row left out: it was
  -- inserted a moment ago, so it must not count against itself.
  declare
    v_limit bigint;
    v_credit bigint;
    v_paid bigint;
    v_credit_refunds bigint;
    v_balance_before bigint;
    v_sale_total bigint := v_lines_total - p_discount_cents;
    v_customer_name text;
  begin
    if p_payment_method = 'credit' and p_customer_id is not null
       and not exists (select 1 from public.profiles where id = v_actor and role = 'owner') then
      v_limit := public.customer_credit_limit(p_customer_id);

      select coalesce(sum(total_cents), 0) into v_credit
      from public.sales
      where customer_id = p_customer_id
        and payment_method = 'credit'
        and voided_at is null
        and id <> p_sale_id;

      select coalesce(sum(amount_cents), 0) into v_paid
      from public.customer_payments
      where customer_id = p_customer_id;

      -- Credit refunds (migration 046) lower what the customer owes, exactly as
      -- in customer_balances.
      select coalesce(sum(r.refund_cents), 0) into v_credit_refunds
      from public.sale_returns r
      join public.sales s on s.id = r.sale_id
      where s.customer_id = p_customer_id
        and r.refund_method = 'credit';

      v_balance_before := v_credit - v_paid - v_credit_refunds;

      if v_balance_before + v_sale_total > v_limit then
        select name into v_customer_name from public.customers where id = p_customer_id;
        update public.sales set needs_credit_review = true where id = p_sale_id;
        insert into public.activity_log (actor_id, action, entity_id, details)
        values (
          v_actor,
          'credit_over_customer_limit',
          p_sale_id,
          jsonb_build_object(
            'sale_id', p_sale_id,
            'occurred_at', p_occurred_at,
            'customer_id', p_customer_id,
            'customer_name', v_customer_name,
            'limit_cents', v_limit,
            'balance_before_cents', v_balance_before,
            'sale_total_cents', v_sale_total
          )
        );
      end if;
    end if;
  exception when others then
    raise warning 'customer credit review skipped for sale %: %', p_sale_id, sqlerrm;
  end;

  return p_sale_id;
end;
$$;
