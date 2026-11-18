-- Staff deactivation (migration 040). Runs in CI after `supabase db reset`, as
-- postgres. Every write is rolled back. The seed has an owner 'aa' and a
-- cashier 'bb'.
begin;

-- A second owner and a second cashier.
insert into auth.users (id, email, instance_id, aud, role)
values ('00000000-0000-0000-0000-0000000000c1', 'owner2-staff@example.test',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
       ('00000000-0000-0000-0000-0000000000c2', 'cashier2-staff@example.test',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
on conflict (id) do nothing;
insert into public.profiles (id, full_name, role)
values ('00000000-0000-0000-0000-0000000000c1', 'Second owner', 'owner'),
       ('00000000-0000-0000-0000-0000000000c2', 'Second cashier', 'cashier')
on conflict (id) do update set full_name = excluded.full_name, role = excluded.role;

-- A past sale rung up by bb, and a live session for bb.
insert into public.sales (id, cashier_id, payment_method, discount_cents, total_cents, occurred_at)
values ('50000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000bb',
        'cash', 0, 100, '2026-03-01 10:00+00');
insert into auth.sessions (user_id) values ('00000000-0000-0000-0000-0000000000bb');

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  bb uuid := '00000000-0000-0000-0000-0000000000bb';
  owner2 uuid := '00000000-0000-0000-0000-0000000000c1';
  cc uuid := '00000000-0000-0000-0000-0000000000c2';
  nobody uuid := '00000000-0000-0000-0000-0000000000dd';
  n int;
  t1 timestamptz;
  who uuid;
  nm text;
  total_before int;
begin
  select count(*) into total_before from public.sales where cashier_id = bb;
  ------------------------------------------------ the check is registered
  if not exists (
    select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
     where r.rolname = 'authenticator'
       and 'pgrst.db_pre_request=public.check_active_staff' = any (s.setconfig)
  ) then raise exception 'authenticator has no pgrst.db_pre_request'; end if;

  ------------------------------------------------ everyone passes while active
  perform pg_temp.as_user(bb);
  set local role authenticated;
  perform public.check_active_staff();
  reset role;
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  perform public.check_active_staff();
  reset role;

  ------------------------------------------------ a cashier cannot manage staff
  perform pg_temp.as_user(bb);
  set local role authenticated;
  begin
    perform public.set_staff_active(cc, false);
    reset role; raise exception 'a cashier deactivated someone';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_staff_active(bb, true);
    reset role; raise exception 'a cashier called set_staff_active on themself';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.list_staff();
    reset role; raise exception 'a cashier listed the staff';
  exception when insufficient_privilege then null;
  end;
  reset role;

  ------------------------------------------------ anon cannot call them either
  set local role anon;
  begin
    perform public.set_staff_active(bb, false);
    reset role; raise exception 'anon executed set_staff_active';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.list_staff();
    reset role; raise exception 'anon executed list_staff';
  exception when insufficient_privilege then null;
  end;
  reset role;

  ------------------------------------------------ the owner's own rules
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  begin
    perform public.set_staff_active(owner_id, false);
    reset role; raise exception 'the owner deactivated themself';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.set_staff_active(owner2, false);
    reset role; raise exception 'the owner deactivated another owner';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.set_staff_active('00000000-0000-0000-0000-00000000ffff', false);
    reset role; raise exception 'an unknown user was accepted';
  exception when no_data_found then null;
  end;
  -- list_staff: names, emails, roles; the owner sees everyone.
  select count(*) into n from public.list_staff()
   where email in ('cashier2-staff@example.test', 'owner2-staff@example.test', 'owner@corniche.local');
  if n <> 3 then reset role; raise exception 'list_staff returned % of the 3 known people', n; end if;
  reset role;
  if (select deactivated_at from public.profiles where id = owner_id) is not null
     or (select deactivated_at from public.profiles where id = owner2) is not null then
    raise exception 'an owner ended up deactivated';
  end if;

  ------------------------------------------------ deactivate bb
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  perform public.set_staff_active(bb, false);
  reset role;
  select deactivated_at, deactivated_by into t1, who from public.profiles where id = bb;
  if t1 is null or who is distinct from owner_id then
    raise exception 'deactivation not recorded (% / %)', t1, who;
  end if;
  -- Their sessions are gone (so their refresh tokens die with them).
  if exists (select 1 from auth.sessions where user_id = bb) then
    raise exception 'sessions of the deactivated user were kept';
  end if;
  -- Idempotent: a second call keeps the first time and actor.
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  perform public.set_staff_active(bb, false);
  reset role;
  if (select deactivated_at from public.profiles where id = bb) is distinct from t1 then
    raise exception 'a second deactivation moved the timestamp';
  end if;

  ------------------------------------------------ the pre-request check refuses them
  perform pg_temp.as_user(bb);
  set local role authenticated;
  begin
    perform public.check_active_staff();
    reset role; raise exception 'a deactivated caller passed the pre-request check';
  exception when sqlstate 'PT403' then null;
  end;
  reset role;
  begin
    perform public.check_active_staff();  -- still bb's claims, as postgres: the check is not role based
    raise exception 'a deactivated caller passed as postgres';
  exception when sqlstate 'PT403' then null;
  end;
  -- Active staff, anon and a user without a profile still pass.
  perform pg_temp.as_user(cc);
  set local role authenticated;
  perform public.check_active_staff();
  reset role;
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  perform public.check_active_staff();
  reset role;
  perform pg_temp.as_user(nobody);
  set local role authenticated;
  perform public.check_active_staff();
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  perform public.check_active_staff();
  reset role;

  ------------------------------------------------ a deactivated cashier cannot reactivate themself
  perform pg_temp.as_user(bb);
  set local role authenticated;
  begin
    update public.profiles set deactivated_at = null where id = bb;
    reset role; raise exception 'a cashier cleared their own deactivated_at';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set deactivated_by = null, deactivated_at = null where id = bb;
    reset role; raise exception 'a cashier cleared both columns';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_staff_active(bb, true);
    reset role; raise exception 'a deactivated cashier reactivated themself';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.profiles where id = bb;
    reset role; raise exception 'a cashier deleted their own profile';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.profiles (id, full_name, role) values (bb, 'again', 'cashier')
      on conflict (id) do update set deactivated_at = null;
    reset role; raise exception 'a cashier upserted their profile';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- Second layer, independent of grants: even if a column grant ever came
  -- back, the trigger still refuses the API roles.
  grant update (deactivated_at, deactivated_by) on public.profiles to authenticated;
  grant insert, delete on public.profiles to authenticated;
  perform pg_temp.as_user(bb);
  set local role authenticated;
  begin
    update public.profiles set deactivated_at = null where id = bb;
    reset role; raise exception 'trigger layer: a cashier cleared deactivated_at';
  exception when insufficient_privilege then null;
  end;
  reset role;
  -- (the owner policy "owner manages profiles" lets an owner write any row, so
  -- this is the owner path the trigger must close)
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  begin
    update public.profiles set deactivated_at = null where id = bb;
    reset role; raise exception 'trigger layer: an owner cleared deactivated_at directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set deactivated_at = now(), deactivated_by = owner_id where id = cc;
    reset role; raise exception 'trigger layer: an owner deactivated by direct update';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.profiles where id = bb;
    reset role; raise exception 'trigger layer: an owner deleted a profile';
  exception when insufficient_privilege then null;
  end;
  reset role;
  revoke update (deactivated_at, deactivated_by) on public.profiles from authenticated;
  revoke insert, delete on public.profiles from authenticated;

  -- The owner's direct update of the columns they may still change keeps working.
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  update public.profiles set full_name = 'Amina Cashier' where id = bb;
  reset role;
  perform pg_temp.as_user(cc);
  set local role authenticated;
  update public.profiles set full_name = 'Second cashier (renamed)' where id = cc;
  reset role;
  if (select full_name from public.profiles where id = cc) <> 'Second cashier (renamed)' then
    raise exception 'an active cashier can no longer update their own name';
  end if;

  ------------------------------------------------ past records keep the name
  select p.full_name into nm
    from public.sales s join public.profiles p on p.id = s.cashier_id
   where s.id = '50000000-0000-0000-0000-0000000000d1';
  if nm is distinct from 'Amina Cashier' then
    raise exception 'the past sale lost its cashier name (%)', nm;
  end if;
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  select count(*) into n from public.sales where cashier_id = bb;
  if n <> total_before or n < 1 then
    reset role; raise exception 'owner sees % of % past sales of the deactivated cashier', n, total_before;
  end if;
  select count(*) into n from public.profiles where id = bb;
  if n <> 1 then reset role; raise exception 'the deactivated profile is not visible to the owner'; end if;
  select count(*) into n from public.list_staff() where id = bb and deactivated_at is not null;
  if n <> 1 then reset role; raise exception 'list_staff does not show the deactivated cashier'; end if;
  reset role;

  ------------------------------------------------ reactivation restores access
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  perform public.set_staff_active(bb, true);
  perform public.set_staff_active(bb, true);  -- idempotent
  reset role;
  if (select deactivated_at from public.profiles where id = bb) is not null
     or (select deactivated_by from public.profiles where id = bb) is not null then
    raise exception 'reactivation did not clear the columns';
  end if;
  perform pg_temp.as_user(bb);
  set local role authenticated;
  perform public.check_active_staff();
  reset role;
end $$;

rollback;
