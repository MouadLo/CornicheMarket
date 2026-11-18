-- Void requests (migration 038). Runs in CI after `supabase db reset`, as postgres.
-- Every write is rolled back.
begin;

-- Start from no closed day (a developer's local database may have one).
delete from public.day_closes;

-- A second cashier (the seed has an owner 'aa' and a cashier 'bb').
insert into auth.users (id, email, instance_id, aud, role)
values ('00000000-0000-0000-0000-0000000000cc', 'cashier2-voidreq@example.test',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
on conflict (id) do nothing;
insert into public.profiles (id, full_name, role)
values ('00000000-0000-0000-0000-0000000000cc', 'Second cashier', 'cashier')
on conflict (id) do nothing;

insert into public.products (id, name, selling_price_cents, stock_quantity)
values ('20000000-0000-0000-0000-000000000001', 'Void request product', 500, 10);

-- Sale 1 by cashier bb, sale 2 by cashier cc, sale 3 by bb, sale 4 by bb (2 units).
insert into public.sales (id, cashier_id, payment_method, discount_cents, total_cents, occurred_at)
values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000bb', 'cash', 0, 500, now()),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000cc', 'cash', 0, 500, now()),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000bb', 'cash', 0, 500, now()),
  ('30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000bb', 'cash', 0, 1000, now());
insert into public.sale_items (sale_id, product_id, quantity, unit_price_cents, line_total_cents)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, 500, 500),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 2, 500, 1000);

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  bb uuid := '00000000-0000-0000-0000-0000000000bb';
  cc uuid := '00000000-0000-0000-0000-0000000000cc';
  s1 uuid := '30000000-0000-0000-0000-000000000001';
  s2 uuid := '30000000-0000-0000-0000-000000000002';
  s3 uuid := '30000000-0000-0000-0000-000000000003';
  s4 uuid := '30000000-0000-0000-0000-000000000004';
  prod uuid := '20000000-0000-0000-0000-000000000001';
  r1 uuid; r3 uuid; r4 uuid;
  stock_before numeric;
  n int;
begin
  select stock_quantity into stock_before from public.products where id = prod;

  ---------------------------------------------------------------- cashier bb
  perform pg_temp.as_user(bb);

  -- Own sale: fine. Someone else's sale: refused.
  r1 := public.request_void(s1, 'wrong_item');
  begin
    perform public.request_void(s2, 'wrong_item');
    raise exception 'asked about another cashier''s sale';
  exception when insufficient_privilege then null;
  end;

  -- Duplicate pending request refused.
  begin
    perform public.request_void(s1, 'wrong_quantity');
    raise exception 'two pending requests for one sale';
  exception when unique_violation then null;
  end;

  -- "other" needs a note; an unknown reason is refused.
  begin
    perform public.request_void(s3, 'other', '   ');
    raise exception 'other without a note';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.request_void(s3, 'because', 'x');
    raise exception 'unknown reason';
  exception when invalid_parameter_value then null;
  end;
  r3 := public.request_void(s3, 'other', 'customer left without paying');
  r4 := public.request_void(s4, 'wrong_quantity');

  -- The sale still counts: nothing was voided by asking.
  if exists (select 1 from public.sales where id in (s1, s3, s4) and voided_at is not null) then
    raise exception 'asking voided the sale';
  end if;

  -- A cashier sees only their own requests.
  perform pg_temp.as_user(cc);
  perform public.request_void(s2, 'customer_changed_mind');
  set local role authenticated;
  select count(*) into n from public.void_requests;
  if n <> 1 then reset role; raise exception 'cashier cc sees % requests', n; end if;
  perform pg_temp.as_user(bb);
  select count(*) into n from public.void_requests;
  if n <> 3 then reset role; raise exception 'cashier bb sees % requests', n; end if;

  -- No direct writes to the table, no deciding, no voiding.
  begin
    insert into public.void_requests (sale_id, reason_code, status) values (s1, 'wrong_item', 'approved');
    raise exception 'cashier inserted directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.void_requests set status = 'approved' where id = r1;
    raise exception 'cashier updated directly';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.void_requests where id = r1;
    raise exception 'cashier deleted directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.decide_void_request(r1, true);
    raise exception 'cashier decided a request';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.void_sale(s1, 'direct');
    raise exception 'cashier voided a sale';
  exception when others then
    if sqlerrm <> 'Only an owner can void a sale' then raise; end if;
  end;
  reset role;

  -- Anonymous callers cannot reach the functions at all.
  set local role anon;
  begin
    perform public.request_void(s1, 'wrong_item');
    raise exception 'anon asked for a void';
  exception when insufficient_privilege then null;
  end;
  reset role;

  ------------------------------------------------------------------- owner
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  select count(*) into n from public.void_requests;
  reset role;
  if n <> 4 then raise exception 'owner sees % requests', n; end if;

  -- Approve: sale voided, stock back, request marked.
  select stock_quantity into stock_before from public.products where id = prod;
  perform public.decide_void_request(r4, true);
  if not exists (select 1 from public.sales where id = s4 and voided_at is not null and voided_by = owner_id
                 and void_reason like 'wrong_quantity%requested by%') then
    raise exception 'approve did not void the sale';
  end if;
  if (select stock_quantity from public.products where id = prod) <> stock_before + 2 then
    raise exception 'approve did not restore stock';
  end if;
  if not exists (select 1 from public.void_requests where id = r4 and status = 'approved'
                 and decided_by = owner_id and decided_at is not null) then
    raise exception 'request not marked approved';
  end if;

  -- Refuse: the sale is untouched.
  perform public.decide_void_request(r3, false, 'Keep it, I checked the till');
  if exists (select 1 from public.sales where id = s3 and voided_at is not null) then
    raise exception 'refuse voided the sale';
  end if;
  if not exists (select 1 from public.void_requests where id = r3 and status = 'refused'
                 and refusal_note = 'Keep it, I checked the till') then
    raise exception 'request not marked refused';
  end if;

  -- A decided request cannot be decided again.
  begin
    perform public.decide_void_request(r4, false);
    raise exception 'decided twice';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.decide_void_request(r3, true);
    raise exception 'approved a refused request';
  exception when invalid_parameter_value then null;
  end;

  -- After a refusal the cashier may ask again (one pending at a time).
  perform pg_temp.as_user(bb);
  perform public.request_void(s3, 'wrong_item');
  -- ...but not for a sale that is already voided.
  begin
    perform public.request_void(s4, 'wrong_item');
    raise exception 'asked about a voided sale';
  exception when invalid_parameter_value then null;
  end;

  -- Closed day: the owner's approval fails and the request stays pending.
  perform pg_temp.as_user(owner_id);
  perform public.close_day(public.store_day(now()), 0, 0, 0);
  begin
    perform public.decide_void_request(r1, true);
    raise exception 'approved in a closed day';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'The day is closed' then raise; end if;
  end;
  if not exists (select 1 from public.void_requests where id = r1 and status = 'pending')
     or exists (select 1 from public.sales where id = s1 and voided_at is not null) then
    raise exception 'a failed approval changed state';
  end if;
  -- And a cashier cannot even ask on a closed day.
  perform pg_temp.as_user(bb);
  begin
    perform public.request_void('30000000-0000-0000-0000-000000000001', 'wrong_item');
    raise exception 'asked on a closed day';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'The day is closed' then raise; end if;
  end;
end;
$$;

rollback;
