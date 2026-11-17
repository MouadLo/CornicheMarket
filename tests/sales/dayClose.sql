-- Day close (migration 037). Runs in CI after `supabase db reset`, as postgres.
-- Every write is rolled back.
begin;

insert into public.customers (id, name) values ('00000000-0000-0000-0000-0000000000d7', 'Day test client');

-- 2020-03-10: the owner rang cash 1000 + card 500; the cashier rang cash 400
-- on credit 250 and one cash sale of 700 that was voided.
insert into public.sales (id, cashier_id, customer_id, payment_method, discount_cents, total_cents, occurred_at, voided_at, voided_by)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', null, 'cash', 0, 1000, '2020-03-10 12:00+00', null, null),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000aa', null, 'card', 50, 500, '2020-03-10 13:00+00', null, null),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000bb', null, 'cash', 0, 400, '2020-03-10 14:00+00', null, null),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000d7', 'credit', 0, 250, '2020-03-10 15:00+00', null, null),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000bb', null, 'cash', 0, 700, '2020-03-10 16:00+00', now(), '00000000-0000-0000-0000-0000000000aa');
insert into public.customer_payments (customer_id, amount_cents, method, created_by, created_at)
values ('00000000-0000-0000-0000-0000000000d7', 300, 'cash', '00000000-0000-0000-0000-0000000000bb', '2020-03-10 17:00+00');

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id uuid := '00000000-0000-0000-0000-0000000000bb';
  v jsonb;
  c jsonb;
  closed public.day_closes;
begin
  -- Owner: every cashier, figures split by payment method.
  perform pg_temp.as_user(owner_id);
  v := public.day_summary('2020-03-10');
  if jsonb_array_length(v -> 'cashiers') <> 2 then raise exception 'owner should see 2 cashiers: %', v; end if;
  select x into c from jsonb_array_elements(v -> 'cashiers') x where x ->> 'cashier_id' = cashier_id::text;
  if (c ->> 'cash_cents')::bigint <> 400 or (c ->> 'credit_cents')::bigint <> 250
     or (c ->> 'voids_count')::int <> 1 or (c ->> 'voids_cents')::bigint <> 700
     or (c ->> 'cash_payments_cents')::bigint <> 300 then
    raise exception 'wrong cashier row: %', c;
  end if;

  if (public.day_summary() ->> 'day')::date <> public.store_day(now()) then
    raise exception 'a null day is not the store today';
  end if;

  -- A cashier sees only their own row, and never the close or float.
  perform pg_temp.as_user(cashier_id);
  v := public.day_summary('2020-03-10');
  if jsonb_array_length(v -> 'cashiers') <> 1 or v -> 'cashiers' -> 0 ->> 'cashier_id' <> cashier_id::text then
    raise exception 'cashier saw other rows: %', v;
  end if;
  begin
    perform public.close_day('2020-03-10', 0, 0, 0);
    raise exception 'a cashier closed the day';
  exception when insufficient_privilege then null;
  end;

  -- Close: expected = float 2000 + cash 1000 + 400 + repayment 300 (voided 700 excluded).
  perform pg_temp.as_user(owner_id);
  closed := public.close_day('2020-03-10', 2000, 3650, 1500, ' counted twice ');
  if closed.expected_cash_cents <> 3700 then raise exception 'expected cash is %', closed.expected_cash_cents; end if;
  if closed.card_sales_cents <> 500 or closed.credit_sales_cents <> 250 or closed.sales_count <> 4
     or closed.voids_count <> 1 or closed.discounts_cents <> 50 or closed.note <> 'counted twice' then
    raise exception 'wrong snapshot: %', to_jsonb(closed);
  end if;
  begin
    perform public.close_day('2020-03-10', 0, 0, 0);
    raise exception 'closed the same day twice';
  exception when unique_violation then null;
  end;
  begin
    perform public.close_day(public.store_day(now()) + 1, 0, 0, 0);
    raise exception 'closed a future day';
  exception when invalid_parameter_value then null;
  end;

  -- The next day suggests the float left in the drawer.
  v := public.day_summary('2020-03-11');
  if (v ->> 'suggested_float_cents')::bigint <> 1500 then raise exception 'suggested float: %', v; end if;

  -- The lock: no void, no repayment dated in the closed day.
  begin
    perform public.void_sale('10000000-0000-0000-0000-000000000001', 'test');
    raise exception 'voided a sale of a closed day';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    insert into public.customer_payments (customer_id, amount_cents, method, created_by, created_at)
    values ('00000000-0000-0000-0000-0000000000d7', 100, 'cash', cashier_id, '2020-03-10 18:00+00');
    raise exception 'took a repayment in a closed day';
  exception when sqlstate 'P0001' then null;
  end;

  -- A late offline sale from the closed day is booked at arrival instead.
  insert into public.sales (id, cashier_id, payment_method, discount_cents, total_cents, occurred_at)
  values ('10000000-0000-0000-0000-000000000009', cashier_id, 'cash', 0, 100, '2020-03-10 19:00+00');
  if public.store_day((select occurred_at from public.sales where id = '10000000-0000-0000-0000-000000000009')) <> public.store_day(now()) then
    raise exception 'late sale was not moved to today';
  end if;

  -- Reopen only the latest closed day.
  perform public.close_day('2020-03-12', 0, 0, 0);
  begin
    perform public.reopen_day('2020-03-10');
    raise exception 'reopened an older day';
  exception when invalid_parameter_value then null;
  end;
  perform public.reopen_day('2020-03-12');
  perform public.reopen_day('2020-03-10');
  perform public.void_sale('10000000-0000-0000-0000-000000000001', 'after reopen');

  -- Today closed: a sale is refused outright.
  perform public.close_day(public.store_day(now()), 0, 0, 0);
  begin
    insert into public.sales (id, cashier_id, payment_method, discount_cents, total_cents, occurred_at)
    values ('10000000-0000-0000-0000-00000000000a', cashier_id, 'cash', 0, 100, now());
    raise exception 'sold on a closed day';
  exception when sqlstate 'P0001' then null;
  end;
end;
$$;

rollback;
