-- save_web_kit_items (migration 059). Runs in CI after `supabase db reset`, as
-- postgres. Everything is rolled back. The seed has an owner 'aa' and a cashier 'bb'.
begin;

insert into public.web_kits (id, name) values ('kit_sqltest', 'SQL test kit');
insert into public.web_kit_items (kit_id, web_product_id, qty, sort) values
  ('kit_sqltest', 'old1', 1, 0),
  ('kit_sqltest', 'old2', 2, 10);

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end;
$$;
create function pg_temp.expect(p_label text, p_got text, p_want text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception '%: got %, wanted %', p_label, coalesce(p_got, 'success'), coalesce(p_want, 'success');
  end if;
end;
$$;
create function pg_temp.lines() returns text language sql as $$
  select coalesce(string_agg(web_product_id || ':' || qty || ':' || sort, ',' order by sort, web_product_id), '')
  from public.web_kit_items where kit_id = 'kit_sqltest';
$$;

do $$
declare
  owner_id constant uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id constant uuid := '00000000-0000-0000-0000-0000000000bb';
  v_version bigint;
begin
  ---------------------------------------------------------------- owner
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';

  select version into v_version from public.webstore_state;
  perform public.save_web_kit_items('kit_sqltest',
    '[{"id":"p003","qty":2},{"id":"p001","qty":10},{"id":"p002","qty":1}]'::jsonb);
  perform pg_temp.expect('replaced in order', pg_temp.lines(), 'p003:2:10,p001:10:20,p002:1:30');
  if (select version from public.webstore_state) <= v_version then raise exception 'feed version not bumped'; end if;

  -- Invalid input: 22023 and the previous lines are untouched.
  perform pg_temp.expect('qty 0', pg_temp.sqlstate_of($f$select public.save_web_kit_items('kit_sqltest', '[{"id":"p9","qty":0}]')$f$), '22023');
  perform pg_temp.expect('qty 11', pg_temp.sqlstate_of($f$select public.save_web_kit_items('kit_sqltest', '[{"id":"p9","qty":11}]')$f$), '22023');
  perform pg_temp.expect('qty 1.5', pg_temp.sqlstate_of($f$select public.save_web_kit_items('kit_sqltest', '[{"id":"p9","qty":1.5}]')$f$), '22023');
  perform pg_temp.expect('qty text', pg_temp.sqlstate_of($f$select public.save_web_kit_items('kit_sqltest', '[{"id":"p9","qty":"2"}]')$f$), '22023');
  perform pg_temp.expect('13 items', pg_temp.sqlstate_of($f$select public.save_web_kit_items('kit_sqltest',
    (select jsonb_agg(jsonb_build_object('id', 'q' || g, 'qty', 1)) from generate_series(1, 13) g))$f$), '22023');
  perform pg_temp.expect('duplicate id', pg_temp.sqlstate_of($f$select public.save_web_kit_items('kit_sqltest',
    '[{"id":"p1","qty":1},{"id":"p1","qty":2}]')$f$), '22023');
  perform pg_temp.expect('bad id', pg_temp.sqlstate_of($f$select public.save_web_kit_items('kit_sqltest', '[{"id":"bad id!","qty":1}]')$f$), '22023');
  perform pg_temp.expect('id too long', pg_temp.sqlstate_of($f$select public.save_web_kit_items('kit_sqltest',
    '[{"id":"123456789012345678901","qty":1}]')$f$), '22023');
  perform pg_temp.expect('not an array', pg_temp.sqlstate_of($f$select public.save_web_kit_items('kit_sqltest', '{"id":"p1","qty":1}')$f$), '22023');
  perform pg_temp.expect('lines untouched', pg_temp.lines(), 'p003:2:10,p001:10:20,p002:1:30');

  -- 12 items is allowed.
  perform public.save_web_kit_items('kit_sqltest',
    (select jsonb_agg(jsonb_build_object('id', 'q' || g, 'qty', 1)) from generate_series(1, 12) g));
  if (select count(*) from public.web_kit_items where kit_id = 'kit_sqltest') <> 12 then raise exception '12 lines expected'; end if;

  -- Unknown kit.
  perform pg_temp.expect('unknown kit', pg_temp.sqlstate_of($f$select public.save_web_kit_items('nope', '[]')$f$), 'P0002');

  -- Empty array empties the kit.
  perform public.save_web_kit_items('kit_sqltest', '[]'::jsonb);
  perform pg_temp.expect('emptied', pg_temp.lines(), '');
  execute 'reset role';

  ---------------------------------------------------------------- cashier
  perform public.save_web_kit_items('kit_sqltest', '[{"id":"keep","qty":3}]'::jsonb);
  perform pg_temp.as_user(cashier_id);
  execute 'set local role authenticated';
  perform pg_temp.expect('cashier', pg_temp.sqlstate_of($f$select public.save_web_kit_items('kit_sqltest', '[]')$f$), '42501');
  execute 'reset role';
  perform pg_temp.expect('cashier changed nothing', pg_temp.lines(), 'keep:3:10');

  ---------------------------------------------------------------- anon
  execute 'set local role anon';
  perform pg_temp.expect('anon', pg_temp.sqlstate_of($f$select public.save_web_kit_items('kit_sqltest', '[]')$f$), '42501');
  execute 'reset role';
  perform pg_temp.expect('anon changed nothing', pg_temp.lines(), 'keep:3:10');
end;
$$;

rollback;
