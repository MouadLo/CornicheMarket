-- Competitor prices (migration 051). Runs in CI after `supabase db reset`, as
-- postgres. Every write is rolled back. The seed has an owner 'aa' and a
-- cashier 'bb'.
begin;

insert into public.products (id, name, selling_price_cents, unit) values
  ('51000000-0000-0000-0000-000000000001', 'Comp A', 1000, 'piece'),
  ('51000000-0000-0000-0000-000000000002', 'Comp B', 2000, 'kg');

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
-- The SQLSTATE a statement fails with, or null when it succeeds.
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
-- Rows a query returns, as the current role sees them.
create function pg_temp.count_of(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into n;
  return n;
end;
$$;

do $$
declare
  owner_id constant uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id constant uuid := '00000000-0000-0000-0000-0000000000bb';
  a constant uuid := '51000000-0000-0000-0000-000000000001';
  b constant uuid := '51000000-0000-0000-0000-000000000002';
  l1 constant uuid := '51000000-0000-0000-0000-0000000000a1';
  l2 constant uuid := '51000000-0000-0000-0000-0000000000a2';
  l3 constant uuid := '51000000-0000-0000-0000-0000000000a3';
  v_batch uuid;
  v_result jsonb;
  v_n bigint;
begin
  -- Default store-wide floor.
  if (select competitor_min_margin_percent from public.owner_settings where singleton) <> 15 then
    raise exception 'owner_settings default is not 15';
  end if;

  ---------------------------------------------------------------- owner
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';

  insert into public.competitor_links (id, product_id, shop_name, url, mode) values
    (l1, a, 'Shop One', 'https://one.example/product/a', 'auto'),
    (l2, a, 'Shop Two', 'https://two.example/p/a', 'manual'),
    (l3, b, 'Shop One', 'https://one.example/product/b', 'auto');
  insert into public.competitor_price_points (link_id, price_cents, on_sale, in_stock, title, source, observed_at) values
    (l1, 900, false, true, 'old', 'auto', now() - interval '2 days'),
    (l1, 850, true, true, 'newest', 'auto', now() - interval '1 hour'),
    (l2, 950, false, false, 'two', 'manual', now() - interval '3 hours');
  insert into public.product_margin_floors (product_id, min_margin_percent) values (a, 5);
  update public.owner_settings set competitor_min_margin_percent = 20 where singleton;

  if (select count(*) from public.competitor_links) <> 3 then raise exception 'owner cannot read links'; end if;
  if (select count(*) from public.competitor_price_points) <> 3 then raise exception 'owner cannot read points'; end if;
  if (select min_margin_percent from public.product_margin_floors where product_id = a) <> 5 then
    raise exception 'owner cannot read floors';
  end if;

  -- The overview: one row per link, latest point of each link only.
  if (select count(*) from public.competitor_price_overview()) <> 3 then
    raise exception 'overview should have 3 rows, got %', (select count(*) from public.competitor_price_overview());
  end if;
  if (select price_cents from public.competitor_price_overview() where link_id = l1) <> 850 then
    raise exception 'overview did not return the latest point of link 1';
  end if;
  if (select title from public.competitor_price_overview() where link_id = l1) <> 'newest' then
    raise exception 'overview mixed points of one link';
  end if;
  if (select min_margin_percent from public.competitor_price_overview() where link_id = l1) <> 5 then
    raise exception 'product override should win';
  end if;
  if (select min_margin_percent from public.competitor_price_overview() where link_id = l3) <> 20 then
    raise exception 'store default should apply without an override';
  end if;
  if (select margin_override from public.competitor_price_overview() where link_id = l3) is not null then
    raise exception 'margin_override should be null without an override';
  end if;
  if (select price_cents from public.competitor_price_overview() where link_id = l3) is not null then
    raise exception 'a link without a point should have null price';
  end if;

  -- An inactive product is left out of the full overview, but its own screen can ask for it.
  update public.products set active = false where id = b;
  if (select count(*) from public.competitor_price_overview()) <> 2 then raise exception 'inactive product should be hidden'; end if;
  if (select count(*) from public.competitor_price_overview(b)) <> 1 then raise exception 'overview(product) should include it'; end if;
  if (select count(*) from public.competitor_price_overview(a)) <> 2 then raise exception 'overview(product) should list its links'; end if;
  update public.products set active = true where id = b;

  -- Constraints.
  perform pg_temp.expect('http url', pg_temp.sqlstate_of(format(
    $f$insert into public.competitor_links (product_id, shop_name, url) values (%L, 'X', 'http://plain.example/x')$f$, a)), '23514');
  perform pg_temp.expect('javascript url', pg_temp.sqlstate_of(format(
    $f$insert into public.competitor_links (product_id, shop_name, url) values (%L, 'X', 'javascript:alert(1)')$f$, a)), '23514');
  perform pg_temp.expect('empty shop', pg_temp.sqlstate_of(format(
    $f$insert into public.competitor_links (product_id, shop_name, url) values (%L, '  ', 'https://x.example/x')$f$, a)), '23514');
  perform pg_temp.expect('duplicate link', pg_temp.sqlstate_of(format(
    $f$insert into public.competitor_links (product_id, shop_name, url) values (%L, 'Dup', 'https://one.example/product/a')$f$, a)), '23505');
  perform pg_temp.expect('bad mode', pg_temp.sqlstate_of(format(
    $f$insert into public.competitor_links (product_id, shop_name, url, mode) values (%L, 'X', 'https://x.example/m', 'robot')$f$, a)), '23514');
  perform pg_temp.expect('zero price', pg_temp.sqlstate_of(format(
    $f$insert into public.competitor_price_points (link_id, price_cents, source) values (%L, 0, 'auto')$f$, l1)), '23514');
  perform pg_temp.expect('floor 96', pg_temp.sqlstate_of(format(
    $f$update public.product_margin_floors set min_margin_percent = 96 where product_id = %L$f$, a)), '23514');
  perform pg_temp.expect('setting 96', pg_temp.sqlstate_of(
    'update public.owner_settings set competitor_min_margin_percent = 96'), '23514');

  -- Apply suggestions: one undoable batch through the existing undo.
  v_result := public.apply_competitor_price_suggestions(jsonb_build_array(
    jsonb_build_object('product_id', a, 'selling_price_cents', 850),
    jsonb_build_object('product_id', b, 'selling_price_cents', 2000)));
  if (v_result->>'changed')::int <> 1 then raise exception 'only the moved product counts: %', v_result; end if;
  v_batch := (v_result->>'batch_id')::uuid;
  if (select selling_price_cents from public.products where id = a) <> 850 then raise exception 'price not applied'; end if;
  if (select source from public.price_change_batches where id = v_batch) <> 'competitor' then raise exception 'batch source'; end if;
  if (select count(*) from public.selling_price_history where product_id = a and price_cents = 850) < 1 then
    raise exception 'selling_price_history not written';
  end if;
  perform pg_temp.expect('invalid price', pg_temp.sqlstate_of(format(
    $f$select public.apply_competitor_price_suggestions('[{"product_id":"%s","selling_price_cents":0}]'::jsonb)$f$, a)), '22023');
  perform pg_temp.expect('empty apply', pg_temp.sqlstate_of(
    $f$select public.apply_competitor_price_suggestions('[]'::jsonb)$f$), '22023');
  v_result := public.undo_price_change_batch(v_batch);
  if (v_result->>'restored')::int <> 1 or (select selling_price_cents from public.products where id = a) <> 1000 then
    raise exception 'undo did not restore the price: %', v_result;
  end if;
  -- Nothing moved: no batch.
  v_result := public.apply_competitor_price_suggestions(jsonb_build_array(
    jsonb_build_object('product_id', a, 'selling_price_cents', 1000)));
  if (v_result->>'changed')::int <> 0 or (v_result->>'batch_id') is not null then
    raise exception 'no-op apply should not create a batch: %', v_result;
  end if;

  execute 'reset role';

  ---------------------------------------------------------------- cashier
  perform pg_temp.as_user(cashier_id);
  execute 'set local role authenticated';

  -- Reads: RLS hides every row.
  perform pg_temp.expect('cashier links', pg_temp.count_of('select 1 from public.competitor_links')::text, '0');
  perform pg_temp.expect('cashier points', pg_temp.count_of('select 1 from public.competitor_price_points')::text, '0');
  perform pg_temp.expect('cashier floors', pg_temp.count_of('select 1 from public.product_margin_floors')::text, '0');
  perform pg_temp.expect('cashier owner_settings', pg_temp.count_of('select 1 from public.owner_settings')::text, '0');
  -- Writes: refused by RLS (42501) on insert; update/delete touch zero rows.
  perform pg_temp.expect('cashier insert link', pg_temp.sqlstate_of(format(
    $f$insert into public.competitor_links (product_id, shop_name, url) values (%L, 'X', 'https://c.example/x')$f$, a)), '42501');
  perform pg_temp.expect('cashier insert point', pg_temp.sqlstate_of(format(
    $f$insert into public.competitor_price_points (link_id, price_cents, source) values (%L, 100, 'manual')$f$, l1)), '42501');
  perform pg_temp.expect('cashier insert floor', pg_temp.sqlstate_of(format(
    $f$insert into public.product_margin_floors (product_id, min_margin_percent) values (%L, 1)$f$, b)), '42501');
  execute 'update public.competitor_links set shop_name = ''Hacked''';
  execute 'delete from public.competitor_price_points';
  execute 'delete from public.product_margin_floors';
  execute 'update public.owner_settings set competitor_min_margin_percent = 0';
  -- Functions refuse.
  perform pg_temp.expect('cashier overview', pg_temp.sqlstate_of('select * from public.competitor_price_overview()'), '42501');
  perform pg_temp.expect('cashier apply', pg_temp.sqlstate_of(format(
    $f$select public.apply_competitor_price_suggestions('[{"product_id":"%s","selling_price_cents":1}]'::jsonb)$f$, a)), '42501');
  -- The cashier view holds no competitor data.
  if exists (select 1 from information_schema.columns
             where table_name = 'products_cashier_view' and column_name ilike '%competitor%') then
    raise exception 'products_cashier_view exposes competitor data';
  end if;
  execute 'reset role';

  -- The cashier's writes changed nothing.
  if (select count(*) from public.competitor_links where shop_name = 'Hacked') <> 0 then raise exception 'cashier update leaked'; end if;
  if (select count(*) from public.competitor_price_points) <> 3 then raise exception 'cashier delete leaked'; end if;
  if (select competitor_min_margin_percent from public.owner_settings where singleton) <> 20 then
    raise exception 'cashier changed the setting';
  end if;

  ---------------------------------------------------------------- anon
  execute 'set local role anon';
  perform pg_temp.expect('anon links', pg_temp.sqlstate_of('select 1 from public.competitor_links'), '42501');
  perform pg_temp.expect('anon points', pg_temp.sqlstate_of('select 1 from public.competitor_price_points'), '42501');
  perform pg_temp.expect('anon floors', pg_temp.sqlstate_of('select 1 from public.product_margin_floors'), '42501');
  perform pg_temp.expect('anon overview', pg_temp.sqlstate_of('select * from public.competitor_price_overview()'), '42501');
  execute 'reset role';

  ---------------------------------------------------------------- cascade
  delete from public.products where id = a;
  if (select count(*) from public.competitor_links where product_id = a) <> 0 then raise exception 'links did not cascade'; end if;
  if (select count(*) from public.competitor_price_points where link_id in (l1, l2)) <> 0 then raise exception 'points did not cascade'; end if;
  if (select count(*) from public.product_margin_floors where product_id = a) <> 0 then raise exception 'floor did not cascade'; end if;
  if (select count(*) from public.competitor_links where id = l3) <> 1 then raise exception 'cascade removed too much'; end if;
end;
$$;

rollback;
