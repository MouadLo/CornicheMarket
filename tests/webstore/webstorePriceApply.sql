-- apply_webstore_price (migration 058). Runs in CI after `supabase db reset`, as
-- postgres. Everything is rolled back. The seed has an owner 'aa' and a cashier 'bb'.
begin;

insert into public.products (id, name, selling_price_cents, current_cost_cents, stock_quantity, unit) values
  ('58000000-0000-0000-0000-000000000001', 'Price test A', 1000, 600, 5, 'piece'),
  ('58000000-0000-0000-0000-000000000002', 'Price test inactive', 1000, 600, 5, 'piece');
update public.products set active = false where id = '58000000-0000-0000-0000-000000000002';

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

do $$
declare
  owner_id constant uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id constant uuid := '00000000-0000-0000-0000-0000000000bb';
  pa constant uuid := '58000000-0000-0000-0000-000000000001';
  pinactive constant uuid := '58000000-0000-0000-0000-000000000002';
  v_misc uuid;
  v_result jsonb;
  v_batch uuid;
  v_batch2 uuid;
begin
  select id into v_misc from public.products where kind = 'misc';

  ---------------------------------------------------------------- owner
  perform pg_temp.as_user(owner_id);
  set local role authenticated;

  v_result := public.apply_webstore_price(pa, 1200);
  if (v_result ->> 'changed')::int <> 1 or (v_result ->> 'batch_id') is null then
    raise exception 'change should make one batch: %', v_result;
  end if;
  v_batch := (v_result ->> 'batch_id')::uuid;
  if (select selling_price_cents from public.products where id = pa) <> 1200 then raise exception 'price not applied'; end if;
  if (select source from public.price_change_batches where id = v_batch) <> 'webstore' then raise exception 'batch source'; end if;
  if (select product_count from public.price_change_batches where id = v_batch) <> 1 then raise exception 'batch product_count'; end if;
  if (select count(*) from public.price_change_items
      where batch_id = v_batch and product_id = pa and old_price_cents = 1000 and new_price_cents = 1200) <> 1 then
    raise exception 'batch item missing';
  end if;
  if (select count(*) from public.selling_price_history where product_id = pa and price_cents = 1200) < 1 then
    raise exception 'selling_price_history not written';
  end if;

  -- Same price: nothing changes, no batch.
  v_result := public.apply_webstore_price(pa, 1200);
  if (v_result ->> 'changed')::int <> 0 or (v_result ->> 'batch_id') is not null then
    raise exception 'same price should not make a batch: %', v_result;
  end if;
  if (select count(*) from public.price_change_batches where source = 'webstore') <> 1 then
    raise exception 'a no-op left a batch behind';
  end if;

  -- Rejected input.
  perform pg_temp.expect('zero price', pg_temp.sqlstate_of(format('select public.apply_webstore_price(%L, 0)', pa)), '22023');
  perform pg_temp.expect('negative price', pg_temp.sqlstate_of(format('select public.apply_webstore_price(%L, -5)', pa)), '22023');
  perform pg_temp.expect('null price', pg_temp.sqlstate_of(format('select public.apply_webstore_price(%L, null)', pa)), '22023');
  perform pg_temp.expect('unknown product', pg_temp.sqlstate_of(
    $f$select public.apply_webstore_price('58000000-0000-0000-0000-0000000000ff', 500)$f$), 'P0002');
  perform pg_temp.expect('inactive product', pg_temp.sqlstate_of(format('select public.apply_webstore_price(%L, 500)', pinactive)), '55000');
  perform pg_temp.expect('misc product', pg_temp.sqlstate_of(format('select public.apply_webstore_price(%L, 500)', v_misc)), '55000');
  if (select selling_price_cents from public.products where id = pa) <> 1200 then raise exception 'a rejected call changed the price'; end if;

  -- Undo (the existing function) works for this source.
  v_result := public.undo_price_change_batch(v_batch);
  if (v_result ->> 'restored')::int <> 1 or (select selling_price_cents from public.products where id = pa) <> 1000 then
    raise exception 'undo did not restore the price: %', v_result;
  end if;
  perform pg_temp.expect('undo twice', pg_temp.sqlstate_of(format('select public.undo_price_change_batch(%L)', v_batch)), '55000');

  -- The owner edits the price after the change: the undo leaves it alone.
  v_result := public.apply_webstore_price(pa, 1500);
  v_batch2 := (v_result ->> 'batch_id')::uuid;
  update public.products set selling_price_cents = 1700 where id = pa;
  v_result := public.undo_price_change_batch(v_batch2);
  if (v_result ->> 'restored')::int <> 0 or (v_result ->> 'skipped')::int <> 1
     or (select selling_price_cents from public.products where id = pa) <> 1700 then
    raise exception 'undo should skip a product edited since: %', v_result;
  end if;

  execute 'reset role';

  ---------------------------------------------------------------- cashier
  perform pg_temp.as_user(cashier_id);
  execute 'set local role authenticated';
  perform pg_temp.expect('cashier apply', pg_temp.sqlstate_of(format('select public.apply_webstore_price(%L, 500)', pa)), '42501');
  execute 'reset role';
  if (select selling_price_cents from public.products where id = pa) <> 1700 then raise exception 'cashier changed the price'; end if;

  ---------------------------------------------------------------- anon
  execute 'set local role anon';
  perform pg_temp.expect('anon apply', pg_temp.sqlstate_of(format('select public.apply_webstore_price(%L, 500)', pa)), '42501');
  execute 'reset role';
end;
$$;

rollback;
