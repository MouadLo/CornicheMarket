-- ============================================================
-- Hour-of-day buckets (report_by_hour) and daily trend buckets
-- (report_daily_trend) grouped sales by the time zone the CLIENT sent as
-- p_tz -- which queries.ts set to
-- `Intl.DateTimeFormat().resolvedOptions().timeZone`, the BROWSER's own
-- time zone. A sale rung up at 23:30 local time in Casablanca, viewed by
-- someone whose browser is set to UTC or any other zone, would land on
-- the wrong day/hour. Reports must show the SHOP's time, not whoever
-- happens to be looking at the screen.
--
-- store_settings is a singleton (the boolean primary key only ever
-- allows one row) holding the owner-configured store time zone, default
-- Africa/Casablanca. store_timezone() reads it; report_by_hour and
-- report_daily_trend now call that internally instead of trusting a
-- client-supplied p_tz, which is DROPPED from both signatures --
-- `create or replace function` cannot remove a parameter (same
-- restriction already hit once this project -- see
-- 20260101000020_negative_stock_visibility.sql's report_inventory_value
-- fix), so both are dropped and recreated, with their grants re-added.
-- ============================================================

create table store_settings (
  singleton boolean primary key default true,
  timezone text not null default 'Africa/Casablanca',
  updated_at timestamptz not null default now(),
  constraint store_settings_is_singleton check (singleton)
);

insert into store_settings (singleton) values (true);

create trigger trg_store_settings_updated_at
  before update on store_settings
  for each row execute function public.set_updated_at();

alter table store_settings enable row level security;

-- Every signed-in user (cashier included) may need the store's time zone
-- for on-screen clocks/labels; it is not cost data. Only the owner may
-- change it.
create policy "anyone authenticated reads store settings" on store_settings
  for select using (auth.role() = 'authenticated');
create policy "owner updates store settings" on store_settings
  for update using (public.is_owner()) with check (public.is_owner());

grant select on store_settings to authenticated;
grant update (timezone) on store_settings to authenticated;

create function public.store_timezone()
returns text
language sql
stable
as $$
  select timezone from store_settings limit 1;
$$;

grant execute on function public.store_timezone() to authenticated;

drop function if exists public.report_daily_trend(timestamptz, timestamptz, text);

create function public.report_daily_trend(
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
  select
    (e.occurred_at at time zone v_tz)::date as day,
    coalesce(sum(e.net_revenue_cents), 0)::bigint,
    coalesce(sum(e.net_revenue_cents - e.cost_cents), 0)::bigint,
    count(distinct e.sale_id)::bigint
  from sale_line_economics e
  where e.occurred_at >= p_from and e.occurred_at < p_to
  group by (e.occurred_at at time zone v_tz)::date
  order by day;
end;
$$;

grant execute on function public.report_daily_trend(timestamptz, timestamptz) to authenticated;

drop function if exists public.report_by_hour(timestamptz, timestamptz, text);

create function public.report_by_hour(
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
  select
    extract(hour from (e.occurred_at at time zone v_tz))::integer as hour,
    coalesce(sum(e.net_revenue_cents), 0)::bigint,
    count(distinct e.sale_id)::bigint
  from sale_line_economics e
  where e.occurred_at >= p_from and e.occurred_at < p_to
  group by 1
  order by 1;
end;
$$;

grant execute on function public.report_by_hour(timestamptz, timestamptz) to authenticated;
