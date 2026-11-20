-- Undo a bulk price change (migration 045). Runs in CI after `supabase db
-- reset`, as postgres. Every write is rolled back. The seed has an owner 'aa'
-- and a cashier 'bb'.
begin;

insert into public.categories (id, name) values
  ('45000000-0000-0000-0000-0000000000c1', 'Undo Main'),
  ('45000000-0000-0000-0000-0000000000c2', 'Undo Other');
insert into public.products (id, name, selling_price_cents, category_id) values
  ('45000000-0000-0000-0000-000000000001', 'Undo A',    1000, '45000000-0000-0000-0000-0000000000c1'),
  ('45000000-0000-0000-0000-000000000002', 'Undo B',    2000, '45000000-0000-0000-0000-0000000000c1'),
  ('45000000-0000-0000-0000-000000000003', 'Undo Tiny',    1, '45000000-0000-0000-0000-0000000000c1'),
  ('45000000-0000-0000-0000-000000000004', 'Undo Other',  500, '45000000-0000-0000-0000-0000000000c2');

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.price(p_id uuid) returns bigint language sql as $$
  select selling_price_cents from public.products where id = p_id;
$$;

do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id uuid := '00000000-0000-0000-0000-0000000000bb';
  cat1 uuid := '45000000-0000-0000-0000-0000000000c1';
  a uuid := '45000000-0000-0000-0000-000000000001';
  b uuid := '45000000-0000-0000-0000-000000000002';
  tiny uuid := '45000000-0000-0000-0000-000000000003';
  other uuid := '45000000-0000-0000-0000-000000000004';
  v_batch uuid;
  v_batch2 uuid;
  v_result jsonb;
  v_hist_before integer;
begin
  ---------------------------------------------------------------- cashier refused
  perform pg_temp.as_user(cashier_id);
  execute 'set local role authenticated';
  begin
    perform public.bulk_adjust_selling_price(cat1, -10);
    raise exception 'A cashier applied a bulk price change';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.undo_price_change_batch('45000000-0000-0000-0000-00000000ffff');
    raise exception 'A cashier undid a price change';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  ---------------------------------------------------------------- owner: -10% on a category
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  if public.bulk_adjust_selling_price(cat1, -10) <> 3 then
    raise exception 'The bulk change must still return the number of products in scope';
  end if;
  execute 'reset role';

  if pg_temp.price(a) <> 900 or pg_temp.price(b) <> 1800 or pg_temp.price(tiny) <> 1
     or pg_temp.price(other) <> 500 then
    raise exception 'The bulk change did not set the expected prices';
  end if;

  select id into v_batch from public.price_change_batches where category_id = cat1;
  if v_batch is null then raise exception 'No batch recorded'; end if;
  if (select product_count from public.price_change_batches where id = v_batch) <> 2 then
    raise exception 'The batch must count only products whose price changed';
  end if;
  if (select count(*) from public.price_change_items where batch_id = v_batch) <> 2
     or exists (select 1 from public.price_change_items where batch_id = v_batch and product_id = tiny) then
    raise exception 'The batch must hold an item per changed product only';
  end if;
  if not exists (select 1 from public.price_change_items
      where batch_id = v_batch and product_id = a and old_price_cents = 1000 and new_price_cents = 900) then
    raise exception 'The item did not record old and new price';
  end if;
  if not exists (select 1 from public.activity_log where action = 'bulk_price_change' and entity_id = v_batch) then
    raise exception 'The bulk change was not logged';
  end if;

  -- A cashier cannot read batches or items.
  perform pg_temp.as_user(cashier_id);
  execute 'set local role authenticated';
  if (select count(*) from public.price_change_batches) <> 0
     or (select count(*) from public.price_change_items) <> 0 then
    raise exception 'A cashier can read price change records';
  end if;
  begin
    insert into public.price_change_batches (percent) values (1);
    raise exception 'A cashier wrote a batch directly';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  if (select count(*) from public.price_change_batches) < 1 then
    raise exception 'The owner cannot read batches';
  end if;
  begin
    update public.price_change_batches set percent = 0 where id = v_batch;
    raise exception 'The owner wrote a batch directly';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  ---------------------------------------------------------------- a product edited afterwards is skipped
  update public.products set selling_price_cents = 1234 where id = b;
  select count(*) into v_hist_before from public.selling_price_history where product_id = a;

  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  v_result := public.undo_price_change_batch(v_batch);
  execute 'reset role';

  if v_result <> '{"restored": 1, "skipped": 1}'::jsonb then
    raise exception 'Undo returned % instead of 1 restored, 1 skipped', v_result;
  end if;
  if pg_temp.price(a) <> 1000 then raise exception 'Undo did not restore product A'; end if;
  if pg_temp.price(b) <> 1234 then raise exception 'Undo overwrote a later price edit'; end if;
  if (select count(*) from public.selling_price_history where product_id = a) <> v_hist_before + 1 then
    raise exception 'The restore did not write a price history row';
  end if;
  if (select reverted_at is null or reverted_by is distinct from owner_id
      from public.price_change_batches where id = v_batch) then
    raise exception 'The batch was not marked as undone';
  end if;
  if not exists (select 1 from public.activity_log where action = 'bulk_price_undo' and entity_id = v_batch) then
    raise exception 'The undo was not logged';
  end if;

  ---------------------------------------------------------------- twice, and unknown
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  begin
    perform public.undo_price_change_batch(v_batch);
    raise exception 'A batch was undone twice';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.undo_price_change_batch('45000000-0000-0000-0000-00000000ffff');
    raise exception 'An unknown batch was accepted';
  exception when no_data_found then null;
  end;
  execute 'reset role';

  ---------------------------------------------------------------- all products
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  perform public.bulk_adjust_selling_price(null, 10);
  execute 'reset role';
  select id into v_batch2 from public.price_change_batches where category_id is null;
  if v_batch2 is null then raise exception 'No batch recorded for all products'; end if;
  if pg_temp.price(a) <> 1100 or pg_temp.price(other) <> 550 then
    raise exception 'The all-products change did not apply';
  end if;
  if not exists (select 1 from public.price_change_items where batch_id = v_batch2 and product_id = other) then
    raise exception 'The all-products batch missed a product';
  end if;

  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  v_result := public.undo_price_change_batch(v_batch2);
  execute 'reset role';
  if (v_result ->> 'skipped')::integer <> 0 then
    raise exception 'Nothing changed since, nothing should be skipped: %', v_result;
  end if;
  if pg_temp.price(a) <> 1000 or pg_temp.price(other) <> 500 or pg_temp.price(b) <> 1234 then
    raise exception 'Undoing the all-products change did not restore prices';
  end if;

  ---------------------------------------------------------------- nothing moves, no batch
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  perform public.bulk_adjust_selling_price('45000000-0000-0000-0000-0000000000c9', 10);
  execute 'reset role';
  if exists (select 1 from public.price_change_batches where category_id = '45000000-0000-0000-0000-0000000000c9') then
    raise exception 'A change that moved nothing left a batch';
  end if;
end;
$$;

rollback;
