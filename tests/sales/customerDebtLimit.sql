-- Customer debt limit (migration 043). Runs in CI after `supabase db reset`,
-- as postgres. Every write is rolled back. The seed has an owner 'aa' and a
-- cashier 'bb'.
begin;

-- Seeded before any user is impersonated: with no signed-in user the credit
-- limit guard does not apply, like a migration or the service role.
insert into public.products (id, name, selling_price_cents, current_cost_cents, stock_quantity)
values ('43000000-0000-0000-0000-000000000001', 'Debt limit item', 100, 50, 100000);

insert into public.customers (id, name, credit_limit_cents)
values
  ('43000000-0000-0000-0000-0000000000a1', 'Debt default A', null),
  ('43000000-0000-0000-0000-0000000000a2', 'Debt default B (payments)', null),
  ('43000000-0000-0000-0000-0000000000a3', 'Debt default C (voided)', null),
  ('43000000-0000-0000-0000-0000000000a4', 'Debt default D (owner)', null),
  ('43000000-0000-0000-0000-0000000000a5', 'Debt default E (replay)', null),
  ('43000000-0000-0000-0000-0000000000b1', 'Debt higher', 100000),
  ('43000000-0000-0000-0000-0000000000b2', 'Debt lower', 5000),
  ('43000000-0000-0000-0000-0000000000b3', 'Debt no credit', 0);

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- One-line sale: p_cents is a multiple of 100 (the item costs 100 a unit).
create function pg_temp.sale(p_id uuid, p_customer uuid, p_method public.payment_method, p_cents bigint)
returns void language sql as $$
  select public.record_sale(
    p_id, p_customer, p_method, 0,
    jsonb_build_array(jsonb_build_object(
      'product_id', '43000000-0000-0000-0000-000000000001',
      'quantity', p_cents / 100, 'unit_price_cents', 100)),
    now());
$$;

create function pg_temp.flagged(p_id uuid) returns boolean language sql as $$
  select needs_credit_review from public.sales where id = p_id;
$$;

create function pg_temp.logged(p_id uuid) returns int language sql as $$
  select count(*)::int from public.activity_log
   where action = 'credit_over_customer_limit' and entity_id = p_id;
$$;

do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  bb uuid := '00000000-0000-0000-0000-0000000000bb';
  ca uuid := '43000000-0000-0000-0000-0000000000a1';
  cb uuid := '43000000-0000-0000-0000-0000000000a2';
  cc uuid := '43000000-0000-0000-0000-0000000000a3';
  cd uuid := '43000000-0000-0000-0000-0000000000a4';
  ce uuid := '43000000-0000-0000-0000-0000000000a5';
  higher uuid := '43000000-0000-0000-0000-0000000000b1';
  lower uuid := '43000000-0000-0000-0000-0000000000b2';
  nocredit uuid := '43000000-0000-0000-0000-0000000000b3';
  s uuid;
  n int;
  d jsonb;
  r record;
begin
  ---------------------------------------------------------------- the limit itself
  if (select customer_credit_limit_cents from public.store_settings) <> 30000 then
    raise exception 'the store default should be 30000';
  end if;
  if public.customer_credit_limit(ca) <> 30000 then raise exception 'default should apply to a customer with no limit'; end if;
  if public.customer_credit_limit(higher) <> 100000 then raise exception 'a higher own limit should override'; end if;
  if public.customer_credit_limit(lower) <> 5000 then raise exception 'a lower own limit should override'; end if;
  if public.customer_credit_limit(nocredit) <> 0 then raise exception 'limit 0 means no credit'; end if;

  -- Changing the store default moves every customer with no limit of their own.
  update public.store_settings set customer_credit_limit_cents = 12345;
  if public.customer_credit_limit(ca) <> 12345 or public.customer_credit_limit(lower) <> 5000 then
    raise exception 'store default change should only move customers without their own limit';
  end if;
  update public.store_settings set customer_credit_limit_cents = 30000;

  ---------------------------------------------------------------- cashier view of balances
  perform pg_temp.as_user(bb);
  execute 'set local role authenticated';
  select credit_limit_cents, credit_available_cents, balance_cents, credit_limit_override_cents
    into r from public.customer_balances where id = ca;
  if r.credit_limit_cents <> 30000 or r.credit_available_cents <> 30000 or r.balance_cents <> 0
     or r.credit_limit_override_cents is not null then
    raise exception 'balance view wrong for a fresh customer: %', r;
  end if;
  select credit_limit_cents, credit_available_cents, credit_limit_override_cents
    into r from public.customer_balances where id = nocredit;
  if r.credit_limit_cents <> 0 or r.credit_available_cents <> 0 or r.credit_limit_override_cents <> 0 then
    raise exception 'balance view wrong for a no-credit customer: %', r;
  end if;
  execute 'reset role';

  ---------------------------------------------------------------- cashier within / at / over the default
  perform pg_temp.as_user(bb);
  execute 'set local role authenticated';
  perform pg_temp.sale('43100000-0000-0000-0000-000000000001', ca, 'credit', 20000);
  perform pg_temp.sale('43100000-0000-0000-0000-000000000002', ca, 'credit', 10000); -- exactly the limit
  execute 'reset role';
  if pg_temp.flagged('43100000-0000-0000-0000-000000000001') or pg_temp.flagged('43100000-0000-0000-0000-000000000002') then
    raise exception 'a credit sale up to the limit must not be flagged';
  end if;

  perform pg_temp.as_user(bb);
  execute 'set local role authenticated';
  select credit_available_cents into n from public.customer_balances where id = ca;
  if n <> 0 then raise exception 'no room should be left, got %', n; end if;
  perform pg_temp.sale('43100000-0000-0000-0000-000000000003', ca, 'credit', 100);
  execute 'reset role';
  if not pg_temp.flagged('43100000-0000-0000-0000-000000000003') then
    raise exception 'a credit sale over the limit must be flagged';
  end if;
  if (select total_cents from public.sales where id = '43100000-0000-0000-0000-000000000003') <> 100 then
    raise exception 'a flagged sale must still be recorded';
  end if;
  select details into d from public.activity_log
   where action = 'credit_over_customer_limit' and entity_id = '43100000-0000-0000-0000-000000000003';
  if d is null
     or (d ->> 'limit_cents')::bigint <> 30000
     or (d ->> 'balance_before_cents')::bigint <> 30000
     or (d ->> 'sale_total_cents')::bigint <> 100
     or d ->> 'customer_name' <> 'Debt default A'
     or (d ->> 'customer_id')::uuid <> ca
     or d ->> 'sale_id' <> '43100000-0000-0000-0000-000000000003' then
    raise exception 'activity log details wrong: %', d;
  end if;

  ---------------------------------------------------------------- a cash or card sale is never flagged
  perform pg_temp.as_user(bb);
  execute 'set local role authenticated';
  perform pg_temp.sale('43100000-0000-0000-0000-000000000004', null, 'cash', 500000);
  perform pg_temp.sale('43100000-0000-0000-0000-000000000005', ca, 'card', 500000);
  execute 'reset role';
  if pg_temp.flagged('43100000-0000-0000-0000-000000000004') or pg_temp.flagged('43100000-0000-0000-0000-000000000005') then
    raise exception 'only credit sales are checked';
  end if;

  ---------------------------------------------------------------- payments reduce the balance
  perform pg_temp.as_user(bb);
  execute 'set local role authenticated';
  perform pg_temp.sale('43100000-0000-0000-0000-000000000011', cb, 'credit', 30000);
  execute 'reset role';
  insert into public.customer_payments (customer_id, amount_cents, method, created_by)
  values (cb, 15000, 'cash', bb);
  perform pg_temp.as_user(bb);
  execute 'set local role authenticated';
  if (select credit_available_cents from public.customer_balances where id = cb) <> 15000 then
    raise exception 'a payment should open room';
  end if;
  perform pg_temp.sale('43100000-0000-0000-0000-000000000012', cb, 'credit', 15000); -- back to exactly 30000
  perform pg_temp.sale('43100000-0000-0000-0000-000000000013', cb, 'credit', 100);   -- over
  execute 'reset role';
  if pg_temp.flagged('43100000-0000-0000-0000-000000000011') or pg_temp.flagged('43100000-0000-0000-0000-000000000012') then
    raise exception 'within limit after a payment must not be flagged';
  end if;
  if not pg_temp.flagged('43100000-0000-0000-0000-000000000013') then
    raise exception 'over limit after a payment must be flagged';
  end if;
  select details into d from public.activity_log
   where action = 'credit_over_customer_limit' and entity_id = '43100000-0000-0000-0000-000000000013';
  if (d ->> 'balance_before_cents')::bigint <> 30000 then raise exception 'balance before should count the payment, got %', d; end if;

  ---------------------------------------------------------------- voided credit sales do not count
  perform pg_temp.as_user(bb);
  execute 'set local role authenticated';
  perform pg_temp.sale('43100000-0000-0000-0000-000000000021', cc, 'credit', 30000);
  execute 'reset role';
  update public.sales set voided_at = now(), voided_by = owner_id, void_reason = 'test'
   where id = '43100000-0000-0000-0000-000000000021';
  perform pg_temp.as_user(bb);
  execute 'set local role authenticated';
  if (select credit_available_cents from public.customer_balances where id = cc) <> 30000 then
    raise exception 'a voided sale must not count in the balance view';
  end if;
  perform pg_temp.sale('43100000-0000-0000-0000-000000000022', cc, 'credit', 30000);
  execute 'reset role';
  if pg_temp.flagged('43100000-0000-0000-0000-000000000022') then
    raise exception 'a voided credit sale must not count against the limit';
  end if;

  ---------------------------------------------------------------- per-customer exceptions
  perform pg_temp.as_user(bb);
  execute 'set local role authenticated';
  -- Higher than the store default: 50000 passes, up to its own 100000.
  perform pg_temp.sale('43100000-0000-0000-0000-000000000031', higher, 'credit', 50000);
  perform pg_temp.sale('43100000-0000-0000-0000-000000000032', higher, 'credit', 50000);
  perform pg_temp.sale('43100000-0000-0000-0000-000000000033', higher, 'credit', 100);
  -- Lower than the store default: 6000 is over its 5000 although under 30000.
  perform pg_temp.sale('43100000-0000-0000-0000-000000000034', lower, 'credit', 5000);
  perform pg_temp.sale('43100000-0000-0000-0000-000000000035', lower, 'credit', 100);
  -- No credit at all.
  perform pg_temp.sale('43100000-0000-0000-0000-000000000036', nocredit, 'credit', 100);
  execute 'reset role';
  if pg_temp.flagged('43100000-0000-0000-0000-000000000031') or pg_temp.flagged('43100000-0000-0000-0000-000000000032') then
    raise exception 'a higher own limit should allow more than the store default';
  end if;
  if not pg_temp.flagged('43100000-0000-0000-0000-000000000033') then raise exception 'over the higher limit must flag'; end if;
  if pg_temp.flagged('43100000-0000-0000-0000-000000000034') then raise exception 'exactly the lower limit must not flag'; end if;
  if not pg_temp.flagged('43100000-0000-0000-0000-000000000035') then raise exception 'over the lower limit must flag'; end if;
  if not pg_temp.flagged('43100000-0000-0000-0000-000000000036') then raise exception 'limit 0 must flag any credit sale'; end if;
  select details into d from public.activity_log
   where action = 'credit_over_customer_limit' and entity_id = '43100000-0000-0000-0000-000000000036';
  if (d ->> 'limit_cents')::bigint <> 0 then raise exception 'logged limit should be 0, got %', d; end if;

  ---------------------------------------------------------------- the owner is not limited
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  perform pg_temp.sale('43100000-0000-0000-0000-000000000041', cd, 'credit', 500000);
  perform pg_temp.sale('43100000-0000-0000-0000-000000000042', nocredit, 'credit', 500000);
  execute 'reset role';
  if pg_temp.flagged('43100000-0000-0000-0000-000000000041') or pg_temp.flagged('43100000-0000-0000-0000-000000000042')
     or pg_temp.logged('43100000-0000-0000-0000-000000000041') <> 0 then
    raise exception 'an owner credit sale must not be flagged';
  end if;

  ---------------------------------------------------------------- idempotent replay never re-flags
  perform pg_temp.as_user(bb);
  execute 'set local role authenticated';
  perform pg_temp.sale('43100000-0000-0000-0000-000000000051', ce, 'credit', 30000); -- fine
  perform pg_temp.sale('43100000-0000-0000-0000-000000000052', ce, 'credit', 100);   -- over: flagged once
  -- Retries of both (an offline device sending again).
  perform pg_temp.sale('43100000-0000-0000-0000-000000000051', ce, 'credit', 30000);
  perform pg_temp.sale('43100000-0000-0000-0000-000000000052', ce, 'credit', 100);
  execute 'reset role';
  if pg_temp.flagged('43100000-0000-0000-0000-000000000051') or pg_temp.logged('43100000-0000-0000-0000-000000000051') <> 0 then
    raise exception 'a replay of a within-limit sale must not be flagged later';
  end if;
  if pg_temp.logged('43100000-0000-0000-0000-000000000052') <> 1 then
    raise exception 'a replay must not log the breach twice';
  end if;
  if (select count(*) from public.sales where customer_id = ce) <> 2 then
    raise exception 'a replay must not record the sale twice';
  end if;

  ---------------------------------------------------------------- a cashier cannot change limits
  perform pg_temp.as_user(bb);
  execute 'set local role authenticated';
  begin
    update public.customers set credit_limit_cents = 999999 where id = ca;
    raise exception 'cashier changed a customer credit limit';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.customers set credit_limit_cents = null where id = higher;
    raise exception 'cashier cleared a customer credit limit';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.customers (name, credit_limit_cents) values ('Sneaky', 999999);
    raise exception 'cashier created a customer with a credit limit';
  exception when insufficient_privilege then null;
  end;
  -- A cashier can still create a customer (Pay Later), who gets the default.
  insert into public.customers (id, name) values ('43000000-0000-0000-0000-0000000000f1', 'Created at the counter');
  if public.customer_credit_limit('43000000-0000-0000-0000-0000000000f1') <> 30000 then
    raise exception 'a counter-created customer should get the store default';
  end if;
  -- Nor can a cashier change the store default.
  begin
    update public.store_settings set customer_credit_limit_cents = 99999999;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'cashier changed the store credit limit'; end if;
  exception when insufficient_privilege then null;
  end;
  -- Nor dismiss a review.
  begin
    perform public.dismiss_credit_review('43100000-0000-0000-0000-000000000003');
    raise exception 'cashier dismissed a credit review';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  if (select customer_credit_limit_cents from public.store_settings) <> 30000 then raise exception 'store limit changed by a cashier'; end if;
  if (select credit_limit_cents from public.customers where id = ca) is not null then raise exception 'customer limit changed by a cashier'; end if;
  if not pg_temp.flagged('43100000-0000-0000-0000-000000000003') then raise exception 'flag cleared by a cashier'; end if;

  ---------------------------------------------------------------- the owner can
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  update public.customers set credit_limit_cents = 70000 where id = ca;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'owner could not set a customer limit'; end if;
  if public.customer_credit_limit(ca) <> 70000 then raise exception 'owner limit not effective'; end if;
  update public.customers set credit_limit_cents = null where id = ca;
  if public.customer_credit_limit(ca) <> 30000 then raise exception 'clearing the limit should restore the default'; end if;
  update public.store_settings set customer_credit_limit_cents = 40000;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'owner could not set the store default'; end if;
  if public.customer_credit_limit(ca) <> 40000 then raise exception 'new store default not effective'; end if;
  update public.store_settings set customer_credit_limit_cents = 30000;
  begin
    update public.customers set credit_limit_cents = -1 where id = ca;
    raise exception 'a negative limit was accepted';
  exception when check_violation then null;
  end;
  perform public.dismiss_credit_review('43100000-0000-0000-0000-000000000003');
  execute 'reset role';
  if pg_temp.flagged('43100000-0000-0000-0000-000000000003') then raise exception 'owner could not dismiss'; end if;
  if not exists (select 1 from public.activity_log where action = 'credit_review_dismissed'
                  and entity_id = '43100000-0000-0000-0000-000000000003') then
    raise exception 'dismissal should be logged';
  end if;
end;
$$;

rollback;
