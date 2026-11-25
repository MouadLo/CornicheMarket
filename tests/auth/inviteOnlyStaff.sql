-- Migration 060: only invited accounts become staff; day functions are staff only.
-- Runs in CI after `supabase db reset`, as postgres. Everything is rolled back.
begin;

create function pg_temp.expect(p_label text, p_got text, p_want text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception '%: got %, wanted %', p_label, coalesce(p_got, 'null'), coalesce(p_want, 'null');
  end if;
end;
$$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end;
$$;

do $$
declare
  stranger constant uuid := '00000000-0000-0000-0000-00000000e601';
  invited constant uuid := '00000000-0000-0000-0000-00000000e602';
begin
  -- A self-made account (no invited_at): no profile, so no staff rights.
  insert into auth.users (id, email, instance_id, aud, role)
  values (stranger, 'stranger@example.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  perform pg_temp.expect('self-made account gets no profile',
    (select count(*)::text from public.profiles where id = stranger), '0');

  -- An invited account: a cashier profile, named from the metadata.
  insert into auth.users (id, email, instance_id, aud, role, invited_at, raw_user_meta_data)
  values (invited, 'invited@example.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          now(), '{"full_name":"Invited Cashier"}');
  perform pg_temp.expect('invited account becomes cashier',
    (select role::text from public.profiles where id = invited), 'cashier');
  perform pg_temp.expect('invited name kept',
    (select full_name from public.profiles where id = invited), 'Invited Cashier');

  -- The self-made account, signed in, is not staff and reads nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.expect('stranger is not owner', public.is_owner()::text, 'false');
  perform pg_temp.expect('stranger is not active staff', public.is_active_staff()::text, 'false');
  perform pg_temp.expect('stranger sees no suppliers', (select count(*)::text from public.suppliers), '0');
  perform pg_temp.expect('stranger sees no customers', (select count(*)::text from public.customers), '0');
  perform pg_temp.expect('stranger sees no categories', (select count(*)::text from public.categories), '0');
  perform pg_temp.expect('stranger sees no store settings', (select count(*)::text from public.store_settings), '0');
  perform pg_temp.expect('stranger sees no print jobs', (select count(*)::text from public.print_jobs), '0');
  perform pg_temp.expect('stranger sees no grid tiles', (select count(*)::text from public.sell_grid_tiles), '0');
  perform pg_temp.expect('stranger cannot add a customer',
    pg_temp.sqlstate_of($q$insert into public.customers (name) values ('x')$q$), '42501');
  -- The pre-request check refuses the account outright (covers views and RPCs).
  perform pg_temp.expect('pre-request refuses a profile-less account',
    pg_temp.sqlstate_of('select public.check_active_staff()'), 'PT403');
  reset role;

  -- Active staff still pass the pre-request check and read as before.
  perform set_config('request.jwt.claims', json_build_object('sub', invited, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.expect('active cashier passes pre-request', pg_temp.sqlstate_of('select public.check_active_staff()'), null);
  perform pg_temp.expect('active cashier reads categories',
    (select (count(*) > 0)::text from public.categories), 'true');
  perform pg_temp.expect('active cashier reads suppliers',
    (select (count(*) > 0)::text from public.suppliers), 'true');
  reset role;

  -- Anonymous visitors can no longer call the day functions.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  perform pg_temp.expect('anon day_is_closed', pg_temp.sqlstate_of('select public.day_is_closed(current_date)'), '42501');
  perform pg_temp.expect('anon day_summary', pg_temp.sqlstate_of('select public.day_summary(current_date)'), '42501');
  perform pg_temp.expect('anon close_day',
    pg_temp.sqlstate_of('select public.close_day(current_date, 0, 0, 0, null)'), '42501');
  perform pg_temp.expect('anon reopen_day', pg_temp.sqlstate_of('select public.reopen_day(current_date)'), '42501');
  reset role;
end $$;

rollback;
