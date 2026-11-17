-- Day close (UX O2): the owner counts the drawer, the day is locked.
--
-- A day is the STORE's calendar day (store_timezone()). Closing it snapshots
-- the figures and then refuses anything that would change them: a new sale or
-- repayment dated in that day, and a void of a sale from that day. The owner
-- can reopen the most recent closed day if it was closed by mistake.
--
-- Cash expected in the drawer = opening float + cash sales (not voided)
-- + cash repayments taken that day. Card and credit never enter the drawer.

create table public.day_closes (
  day date primary key,
  opening_float_cents bigint not null check (opening_float_cents >= 0),
  expected_cash_cents bigint not null,
  counted_cash_cents bigint not null check (counted_cash_cents >= 0),
  -- Cash kept in the drawer for the next day: becomes its suggested float.
  leave_in_drawer_cents bigint not null check (leave_in_drawer_cents >= 0),
  sales_count integer not null,
  cash_sales_cents bigint not null,
  card_sales_cents bigint not null,
  credit_sales_cents bigint not null,
  cash_payments_cents bigint not null,
  card_payments_cents bigint not null,
  discounts_cents bigint not null,
  voids_count integer not null,
  voids_cents bigint not null,
  note text,
  closed_by uuid not null references public.profiles (id),
  closed_at timestamptz not null default now()
);

alter table public.day_closes enable row level security;

-- Owners read it directly; writes go through close_day / reopen_day only.
create policy day_closes_owner_read on public.day_closes
  for select using (public.is_owner());
revoke insert, update, delete on public.day_closes from authenticated;
grant select on public.day_closes to authenticated;

create function public.store_day(p_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone coalesce(
    (select s.timezone from public.store_settings s limit 1), 'Africa/Casablanca'
  ))::date;
$$;
grant execute on function public.store_day(timestamptz) to authenticated;

-------------------------------------------------------------------------------
-- The figures of one day, per cashier. Owners get every cashier; a cashier gets
-- only their own row (and no drawer or float figures).
-------------------------------------------------------------------------------
-- p_day null means the store's today.
create function public.day_summary(p_day date default null)
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
      'card_payments_cents', coalesce(pr.card_payments_cents, 0)
    ) order by p.full_name), '[]'::jsonb)
  into v_rows
  from public.profiles p
  left join sale_rows sr on sr.cashier_id = p.id
  left join pay_rows pr on pr.cashier_id = p.id
  where (sr.cashier_id is not null or pr.cashier_id is not null);

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
grant execute on function public.day_summary(date) to authenticated;

-- Cheap check the Sell screen uses to stop taking sales on a closed day.
create function public.day_is_closed(p_day date default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.day_closes where day = coalesce(p_day, public.store_day(now()))
  );
$$;
grant execute on function public.day_is_closed(date) to authenticated;

-------------------------------------------------------------------------------
-- Close a day. The expected cash is computed here, never taken from the client.
-------------------------------------------------------------------------------
create function public.close_day(
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

  insert into public.day_closes (
    day, opening_float_cents, expected_cash_cents, counted_cash_cents, leave_in_drawer_cents,
    sales_count, cash_sales_cents, card_sales_cents, credit_sales_cents,
    cash_payments_cents, card_payments_cents, discounts_cents, voids_count, voids_cents,
    note, closed_by
  )
  values (
    p_day, p_opening_float_cents,
    p_opening_float_cents + v_sales.cash_cents + v_pay.cash_cents,
    p_counted_cash_cents, p_leave_in_drawer_cents,
    v_sales.sales_count, v_sales.cash_cents, v_sales.card_cents, v_sales.credit_cents,
    v_pay.cash_cents, v_pay.card_cents, v_sales.discount_cents, v_sales.voids_count, v_sales.voids_cents,
    nullif(btrim(p_note), ''), v_actor
  )
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.close_day(date, bigint, bigint, bigint, text) to authenticated;

-- Only the latest closed day can be reopened, so the floats still chain.
create function public.reopen_day(p_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Only an owner can reopen a day' using errcode = '42501';
  end if;
  if p_day is distinct from (select max(day) from public.day_closes) then
    raise exception 'Only the most recent closed day can be reopened' using errcode = '22023';
  end if;
  delete from public.day_closes where day = p_day;
end;
$$;
grant execute on function public.reopen_day(date) to authenticated;
-- delete runs inside the definer function; the table stays closed to clients.

-------------------------------------------------------------------------------
-- The lock.
-------------------------------------------------------------------------------

-- A new sale: if its own day is closed, a late (offline) sale is booked at the
-- moment it arrives instead; if today is closed too, it is refused.
create function public.guard_closed_day_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.day_closes where day = public.store_day(new.occurred_at)) then
    if exists (select 1 from public.day_closes where day = public.store_day(now())) then
      raise exception 'The day is closed' using errcode = 'P0001';
    end if;
    new.occurred_at := now();
  end if;
  return new;
end;
$$;
create trigger trg_sales_closed_day_insert
  before insert on public.sales
  for each row execute function public.guard_closed_day_sale();

create function public.guard_closed_day_void()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.voided_at is null and new.voided_at is not null
     and exists (select 1 from public.day_closes where day = public.store_day(old.occurred_at)) then
    raise exception 'The day is closed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger trg_sales_closed_day_void
  before update of voided_at on public.sales
  for each row execute function public.guard_closed_day_void();

create function public.guard_closed_day_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.day_closes where day = public.store_day(new.created_at)) then
    raise exception 'The day is closed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger trg_payments_closed_day
  before insert on public.customer_payments
  for each row execute function public.guard_closed_day_payment();
