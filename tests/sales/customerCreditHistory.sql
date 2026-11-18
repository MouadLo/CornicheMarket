-- Customer credit history (migration 039). Runs in CI after `supabase db reset`,
-- as postgres. Every write is rolled back.
begin;

-- A second cashier (the seed has an owner 'aa' and a cashier 'bb').
insert into auth.users (id, email, instance_id, aud, role)
values ('00000000-0000-0000-0000-0000000000cc', 'cashier2-credithist@example.test',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
on conflict (id) do nothing;
insert into public.profiles (id, full_name, role)
values ('00000000-0000-0000-0000-0000000000cc', 'Second cashier', 'cashier')
on conflict (id) do update set full_name = excluded.full_name, role = excluded.role;

insert into public.customers (id, name)
values ('40000000-0000-0000-0000-000000000001', 'History customer A'),
       ('40000000-0000-0000-0000-000000000002', 'History customer B');

-- Customer A: five credit sales (cc rang 1-3, bb rang 4, owner rang 5; sale 2 is
-- voided) plus a cash sale. Customer B: one credit sale by cc.
insert into public.sales (id, cashier_id, customer_id, payment_method, discount_cents, total_cents, occurred_at)
values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000cc', '40000000-0000-0000-0000-000000000001', 'credit', 0, 100, '2026-03-01 10:00+00'),
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000cc', '40000000-0000-0000-0000-000000000001', 'credit', 0, 200, '2026-03-02 10:00+00'),
  ('50000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000cc', '40000000-0000-0000-0000-000000000001', 'credit', 0, 300, '2026-03-03 10:00+00'),
  ('50000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000bb', '40000000-0000-0000-0000-000000000001', 'credit', 0, 400, '2026-03-04 10:00+00'),
  ('50000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000aa', '40000000-0000-0000-0000-000000000001', 'credit', 0, 500, '2026-03-04 10:00+00'),
  ('50000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000cc', '40000000-0000-0000-0000-000000000001', 'cash',   0, 600, '2026-03-05 10:00+00'),
  ('50000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000cc', '40000000-0000-0000-0000-000000000002', 'credit', 0, 700, '2026-03-06 10:00+00');
update public.sales set voided_at = now(), voided_by = '00000000-0000-0000-0000-0000000000aa',
  void_reason = 'secret reason' where id = '50000000-0000-0000-0000-000000000002';

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  bb uuid := '00000000-0000-0000-0000-0000000000bb';
  cc uuid := '00000000-0000-0000-0000-0000000000cc';
  ca uuid := '40000000-0000-0000-0000-000000000001';
  cb uuid := '40000000-0000-0000-0000-000000000002';
  ids uuid[];
  r record;
  n int;
  cols text;
begin
  ------------------------------------------------- cashier bb (rang sale 4 only)
  perform pg_temp.as_user(bb);
  set local role authenticated;

  -- The base table still hides other people's sales.
  select count(*) into n from public.sales where customer_id = ca;
  if n <> 1 then reset role; raise exception 'bb reads % sales directly, expected only their own', n; end if;

  -- ...but the function shows every credit sale of that customer.
  select array_agg(id order by occurred_at desc, id desc) into ids
    from public.customer_credit_sales(ca, 30, 0);
  if ids is distinct from array[
    '50000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000004',
    '50000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000001']::uuid[] then
    reset role; raise exception 'bb sees wrong list: %', ids;
  end if;
  -- (the equal-instant pair 4/5 is ordered by id desc: 5 first)

  -- Own flag and names; voided flagged; the other customer's and cash sales out.
  for r in select * from public.customer_credit_sales(ca, 30, 0) loop
    if r.is_own <> (r.id = '50000000-0000-0000-0000-000000000004') then
      reset role; raise exception 'wrong is_own on %', r.id;
    end if;
    if (r.voided_at is not null) <> (r.id = '50000000-0000-0000-0000-000000000002') then
      reset role; raise exception 'wrong voided flag on %', r.id;
    end if;
    if r.id = '50000000-0000-0000-0000-000000000003' and r.cashier_name <> 'Second cashier' then
      reset role; raise exception 'cashier name missing';
    end if;
  end loop;
  select count(*) into n from public.customer_credit_sales(cb, 30, 0);
  if n <> 1 then reset role; raise exception 'customer B has % rows', n; end if;

  -- No cost, profit or reason column in the result.
  select string_agg(nm, ',' order by ord) into cols
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    cross join lateral unnest(p.proargnames, p.proargmodes) with ordinality as u(nm, md, ord)
   where ns.nspname = 'public' and p.proname = 'customer_credit_sales' and md = 't';
  if cols <> 'id,occurred_at,created_at,total_cents,voided_at,cashier_name,is_own' then
    reset role; raise exception 'unexpected columns: %', cols;
  end if;
  if cols ~* 'cost|profit|reason|discount|unit' then
    reset role; raise exception 'sensitive column returned: %', cols;
  end if;

  -- Paging: pages of 2 walk the list without gaps or repeats.
  select array_agg(id) into ids from (
    select id from public.customer_credit_sales(ca, 2, 0)
    union all select id from public.customer_credit_sales(ca, 2, 2)
    union all select id from public.customer_credit_sales(ca, 2, 4)) x;
  if cardinality(ids) <> 5 or (select count(distinct i) from unnest(ids) i) <> 5 then
    reset role; raise exception 'paging broke: %', ids;
  end if;
  select count(*) into n from public.customer_credit_sales(ca, 2, 5);
  if n <> 0 then reset role; raise exception 'offset past the end returned rows'; end if;

  -- Limit clamping: zero/negative/null become a small page; huge stays capped.
  select count(*) into n from public.customer_credit_sales(ca, 0, 0);
  if n <> 1 then reset role; raise exception 'limit 0 returned % rows', n; end if;
  select count(*) into n from public.customer_credit_sales(ca, null, 0);
  if n <> 5 then reset role; raise exception 'null limit returned % rows', n; end if;
  select count(*) into n from public.customer_credit_sales(ca, 1000000, 0);
  if n <> 5 then reset role; raise exception 'huge limit returned % rows', n; end if;

  -- A negative offset is refused.
  begin
    perform * from public.customer_credit_sales(ca, 10, -1);
    raise exception 'negative offset accepted';
  exception when invalid_parameter_value then null;
  end;
  reset role;

  ------------------------------------------------------------------- the owner
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  select count(*) into n from public.customer_credit_sales(ca, 30, 0);
  if n <> 5 then reset role; raise exception 'owner sees % rows', n; end if;
  select count(*) into n from public.customer_credit_sales(ca, 30, 0) where is_own;
  if n <> 1 then reset role; raise exception 'owner is_own count %', n; end if;
  reset role;

  ----------------------------------------------- no profile / no session / anon
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000dd');
  set local role authenticated;
  begin
    perform * from public.customer_credit_sales(ca, 10, 0);
    raise exception 'a user with no staff profile was served';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', '{}', true);
  set local role authenticated;
  begin
    perform * from public.customer_credit_sales(ca, 10, 0);
    raise exception 'a caller with no auth.uid() was served';
  exception when insufficient_privilege then null;
  end;
  reset role;

  set local role anon;
  begin
    perform * from public.customer_credit_sales(ca, 10, 0);
    raise exception 'anon executed the function';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

rollback;
