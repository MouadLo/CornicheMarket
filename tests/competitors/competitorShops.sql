-- Competitor shops (migration 052). Runs in CI after `supabase db reset`, as
-- postgres. Every write is rolled back. The seed has an owner 'aa' and a
-- cashier 'bb'.
begin;

insert into public.products (id, name, selling_price_cents, unit) values
  ('52000000-0000-0000-0000-000000000001', 'Crunchips Paprika 100g', 1000, 'piece'),
  ('52000000-0000-0000-0000-000000000002', 'Sidi Ali 50cl', 300, 'piece'),
  ('52000000-0000-0000-0000-000000000003', 'Moutarde Star 37cl', 2000, 'piece');
insert into public.suppliers (id, name) values ('52000000-0000-0000-0000-0000000000f1', 'Distrimar');

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
  pa constant uuid := '52000000-0000-0000-0000-000000000001';
  pb constant uuid := '52000000-0000-0000-0000-000000000002';
  pc constant uuid := '52000000-0000-0000-0000-000000000003';
  sup constant uuid := '52000000-0000-0000-0000-0000000000f1';
  shop constant uuid := '52000000-0000-0000-0000-0000000000a1';
  shop2 constant uuid := '52000000-0000-0000-0000-0000000000a2';
  i1 constant uuid := '52000000-0000-0000-0000-0000000000b1';
  i2 constant uuid := '52000000-0000-0000-0000-0000000000b2';
  i3 constant uuid := '52000000-0000-0000-0000-0000000000b3';
  i4 constant uuid := '52000000-0000-0000-0000-0000000000b4';
  v_link uuid;
  v_started timestamptz;
  v_link2 uuid;
  v_n bigint;
  v_page record;
begin
  ---------------------------------------------------------------- service role (the function)
  insert into public.competitor_shops (id, name, base_url, last_sync_started_at, next_page)
  values (shop, 'Night', 'https://night.example', now() - interval '1 minute', 2);
  insert into public.competitor_shops (id, name, base_url) values (shop2, 'Other', 'https://other.example');

  -- A new read is stamped by the database clock and resets the shop to page 1.
  update public.competitor_shops set status = 'error', next_page = 9 where id = shop2;
  v_started := public.start_competitor_shop_read(shop2);
  if v_started is null
     or (select status || next_page from public.competitor_shops where id = shop2) <> 'syncing1'
     or (select last_sync_started_at from public.competitor_shops where id = shop2) > clock_timestamp() then
    raise exception 'start_competitor_shop_read';
  end if;
  perform pg_temp.expect('start unknown shop', pg_temp.sqlstate_of(
    $f$select public.start_competitor_shop_read(gen_random_uuid())$f$), 'P0002');
  update public.competitor_shops set status = 'ok', next_page = null, last_sync_started_at = null where id = shop2;

  perform pg_temp.expect('http base url', pg_temp.sqlstate_of(
    $f$insert into public.competitor_shops (name, base_url) values ('X', 'http://plain.example')$f$), '23514');
  perform pg_temp.expect('path in base url', pg_temp.sqlstate_of(
    $f$insert into public.competitor_shops (name, base_url) values ('X', 'https://x.example/shop')$f$), '23514');
  perform pg_temp.expect('duplicate base url', pg_temp.sqlstate_of(
    $f$insert into public.competitor_shops (name, base_url) values ('X', 'https://night.example')$f$), '23505');
  perform pg_temp.expect('empty name', pg_temp.sqlstate_of(
    $f$insert into public.competitor_shops (name, base_url) values (' ', 'https://e.example')$f$), '23514');
  perform pg_temp.expect('platform', pg_temp.sqlstate_of(
    $f$insert into public.competitor_shops (name, base_url, platform) values ('X', 'https://p.example', 'shopify')$f$), '23514');
  perform pg_temp.expect('status', pg_temp.sqlstate_of(
    $f$update public.competitor_shops set status = 'weird'$f$), '23514');

  -- A read page: facts only.
  v_n := public.upsert_competitor_catalog_items(shop, jsonb_build_array(
    jsonb_build_object('external_id', '1', 'name', 'Lorenz Crunchips Paprika', 'url', 'https://night.example/p/1',
      'price_cents', 1200, 'regular_price_cents', 1200, 'on_sale', false, 'in_stock', true,
      'image_url', 'https://night.example/i1.jpg', 'categories', jsonb_build_array('Chips'), 'popularity_rank', 1),
    jsonb_build_object('external_id', '2', 'name', 'Sidi Ali 1.5L', 'url', 'https://night.example/p/2',
      'price_cents', 900, 'regular_price_cents', 1000, 'on_sale', true, 'in_stock', true,
      'categories', jsonb_build_array('Eau', 'Boissons'), 'popularity_rank', 2),
    jsonb_build_object('external_id', '3', 'name', 'Item three', 'url', 'https://night.example/p/3',
      'price_cents', 5000, 'in_stock', false, 'categories', '[]'::jsonb, 'popularity_rank', 3),
    jsonb_build_object('external_id', '4', 'name', 'Item four', 'url', 'https://night.example/p/4',
      'price_cents', 700, 'categories', jsonb_build_array('Chips'), 'popularity_rank', 4)));
  if v_n <> 4 then raise exception 'upsert count %', v_n; end if;
  update public.competitor_catalog_items set id = i1 where shop_id = shop and external_id = '1';
  update public.competitor_catalog_items set id = i2 where shop_id = shop and external_id = '2';
  update public.competitor_catalog_items set id = i3 where shop_id = shop and external_id = '3';
  update public.competitor_catalog_items set id = i4 where shop_id = shop and external_id = '4';
  if (select decision from public.competitor_catalog_items where id = i1) <> 'undecided' then raise exception 'default decision'; end if;

  perform pg_temp.expect('item http url', pg_temp.sqlstate_of(format(
    $f$insert into public.competitor_catalog_items (shop_id, external_id, name, url) values (%L, 'x', 'N', 'http://a.example/x')$f$, shop)), '23514');
  perform pg_temp.expect('item duplicate external id', pg_temp.sqlstate_of(format(
    $f$insert into public.competitor_catalog_items (shop_id, external_id, name, url) values (%L, '1', 'N', 'https://a.example/x')$f$, shop)), '23505');
  perform pg_temp.expect('item bad decision', pg_temp.sqlstate_of(format(
    $f$update public.competitor_catalog_items set decision = 'weird' where id = %L$f$, i1)), '23514');
  perform pg_temp.expect('item bad sourcing status', pg_temp.sqlstate_of(format(
    $f$update public.competitor_catalog_items set sourcing_status = 'weird' where id = %L$f$, i1)), '23514');
  perform pg_temp.expect('item long note', pg_temp.sqlstate_of(format(
    $f$update public.competitor_catalog_items set sourcing_note = repeat('x', 301) where id = %L$f$, i1)), '23514');

  -- Matches: one proposal per product, uncertain flag, the rest missing.
  v_n := public.apply_competitor_matches(shop, jsonb_build_array(
    jsonb_build_object('item_id', i1, 'product_id', pa, 'score', 0.91, 'uncertain', false),
    jsonb_build_object('item_id', i2, 'product_id', pb, 'score', 0.55, 'uncertain', true),
    jsonb_build_object('item_id', i3, 'product_id', null, 'score', 0, 'uncertain', false),
    -- same product as i1 but a lower score: loses
    jsonb_build_object('item_id', i4, 'product_id', pa, 'score', 0.6, 'uncertain', true)));
  if v_n <> 4 then raise exception 'apply count %', v_n; end if;
  if (select decision from public.competitor_catalog_items where id = i1) <> 'proposed'
     or (select candidate_product_id from public.competitor_catalog_items where id = i1) <> pa then
    raise exception 'i1 not proposed';
  end if;
  if not (select match_uncertain from public.competitor_catalog_items where id = i2) then raise exception 'uncertain flag'; end if;
  if (select decision from public.competitor_catalog_items where id = i3) <> 'missing' then raise exception 'i3 not missing'; end if;
  if (select decision from public.competitor_catalog_items where id = i4) <> 'missing' then raise exception 'duplicate product proposal'; end if;
  perform pg_temp.expect('two proposals one product', pg_temp.sqlstate_of(format(
    $f$update public.competitor_catalog_items set decision = 'proposed', candidate_product_id = %L where id = %L$f$, pa, i4)), '23505');

  ---------------------------------------------------------------- owner
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';

  if (select count(*) from public.competitor_shops) <> 2 then raise exception 'owner cannot read shops'; end if;
  if (select count(*) from public.competitor_catalog_items) <> 4 then raise exception 'owner cannot read items'; end if;
  perform pg_temp.expect('owner cannot insert a shop', pg_temp.sqlstate_of(
    $f$insert into public.competitor_shops (name, base_url) values ('Mine', 'https://mine.example')$f$), '42501');
  perform pg_temp.expect('owner cannot insert an item', pg_temp.sqlstate_of(format(
    $f$insert into public.competitor_catalog_items (shop_id, external_id, name, url) values (%L, 'q', 'N', 'https://a.example/x')$f$, shop)), '42501');
  perform pg_temp.expect('owner cannot update an item', pg_temp.sqlstate_of(format(
    $f$update public.competitor_catalog_items set decision = 'matched' where id = %L$f$, i1)), '42501');
  perform pg_temp.expect('owner cannot start a read', pg_temp.sqlstate_of(format(
    $f$select public.start_competitor_shop_read(%L)$f$, shop)), '42501');
  perform pg_temp.expect('owner cannot run service rpc', pg_temp.sqlstate_of(format(
    $f$select public.apply_competitor_matches(%L, '[]'::jsonb)$f$, shop)), '42501');
  perform pg_temp.expect('owner cannot upsert', pg_temp.sqlstate_of(format(
    $f$select public.upsert_competitor_catalog_items(%L, '[]'::jsonb)$f$, shop)), '42501');

  -- overview and counts
  select * into v_page from public.competitor_shop_overview() where id = shop;
  if v_page.items_count <> 4 or v_page.proposed_count <> 2 or v_page.missing_count <> 2 then
    raise exception 'overview counts: %', v_page;
  end if;
  select proposed, missing, wanted into v_page from public.competitor_catalog_counts();
  if v_page.proposed <> 2 or v_page.missing <> 2 or v_page.wanted <> 0 then raise exception 'counts: %', v_page; end if;

  -- pages: filters and sorts
  if (select count(*) from public.competitor_catalog_page('missing')) <> 2 then raise exception 'missing page'; end if;
  if (select id from public.competitor_catalog_page('missing', null, null, false, false, 'price_desc') limit 1) <> i3 then
    raise exception 'price_desc';
  end if;
  if (select id from public.competitor_catalog_page('missing', null, null, false, false, 'price_asc') limit 1) <> i4 then
    raise exception 'price_asc';
  end if;
  if (select count(*) from public.competitor_catalog_page('missing', null, null, true)) <> 1 then raise exception 'in stock only'; end if;
  if (select count(*) from public.competitor_catalog_page('missing', null, 'Chips')) <> 1 then raise exception 'category filter'; end if;
  if (select count(*) from public.competitor_catalog_page('proposed', null, null, false, true)) <> 1 then raise exception 'promo only'; end if;
  if (select total_count from public.competitor_catalog_page('missing', null, null, false, false, 'popularity', 1, 0)) <> 2 then
    raise exception 'total_count should ignore the page size';
  end if;
  if (select count(*) from public.competitor_catalog_page('missing', shop2)) <> 0 then raise exception 'shop filter'; end if;
  if (select candidate_product_name from public.competitor_catalog_page('proposed') where id = i1) <> 'Crunchips Paprika 100g' then
    raise exception 'candidate name';
  end if;
  if (select count(*) from public.competitor_catalog_categories('missing')) <> 1 then raise exception 'categories'; end if;
  perform pg_temp.expect('unknown view', pg_temp.sqlstate_of($f$select * from public.competitor_catalog_page('all')$f$), '22023');

  -- confirm: link + first point, stamped with last_seen_at
  v_link := public.confirm_competitor_match(i1, pa);
  if (select count(*) from public.competitor_links where id = v_link and product_id = pa
        and url = 'https://night.example/p/1' and shop_name = 'Night' and mode = 'auto') <> 1 then
    raise exception 'confirm did not create the link';
  end if;
  if (select count(*) from public.competitor_price_points where link_id = v_link and price_cents = 1200
        and source = 'auto' and title = 'Lorenz Crunchips Paprika'
        and image_url = 'https://night.example/i1.jpg') <> 1 then
    raise exception 'confirm did not create the point';
  end if;
  if (select decision from public.competitor_catalog_items where id = i1) <> 'matched'
     or (select link_id from public.competitor_catalog_items where id = i1) <> v_link
     or (select candidate_product_id from public.competitor_catalog_items where id = i1) is not null then
    raise exception 'item not matched';
  end if;
  if (select count(*) from public.competitor_price_overview() where link_id = v_link) <> 1 then
    raise exception 'the product is not in the tracked list';
  end if;
  -- idempotent
  if public.confirm_competitor_match(i1, pa) <> v_link then raise exception 'second confirm returned another link'; end if;
  if (select count(*) from public.competitor_price_points where link_id = v_link) <> 1 then raise exception 'second point'; end if;
  if (select count(*) from public.competitor_links where product_id = pa) <> 1 then raise exception 'second link'; end if;
  -- another product for an already matched item, and a product matched twice
  perform pg_temp.expect('item matched elsewhere', pg_temp.sqlstate_of(format(
    $f$select public.confirm_competitor_match(%L, %L)$f$, i1, pb)), '23505');
  perform pg_temp.expect('product matched twice', pg_temp.sqlstate_of(format(
    $f$select public.confirm_competitor_match(%L, %L)$f$, i4, pa)), '23505');
  perform pg_temp.expect('unknown product', pg_temp.sqlstate_of(format(
    $f$select public.confirm_competitor_match(%L, gen_random_uuid())$f$, i2)), 'P0002');
  perform pg_temp.expect('unknown item', pg_temp.sqlstate_of(format(
    $f$select public.confirm_competitor_match(gen_random_uuid(), %L)$f$, pb)), 'P0002');
  -- confirm with another product (the owner chose it): reuses an existing link when (product, url) exists
  insert into public.competitor_links (id, product_id, shop_name, url, mode)
    values ('52000000-0000-0000-0000-0000000000c1', pc, 'Night', 'https://night.example/p/2', 'manual');
  insert into public.competitor_price_points (link_id, price_cents, source) values ('52000000-0000-0000-0000-0000000000c1', 950, 'manual');
  v_link2 := public.confirm_competitor_match(i2, pc);
  if (select count(*) from public.competitor_links where product_id = pc and url = 'https://night.example/p/2') <> 1 then
    raise exception 'existing link not reused';
  end if;
  if v_link2 <> '52000000-0000-0000-0000-0000000000c1'
     or (select count(*) from public.competitor_price_points where link_id = v_link2) <> 1 then
    raise exception 'a link that already existed must not get a catalogue point';
  end if;

  -- reject / want / ignore / sourcing
  perform pg_temp.expect('reject a non proposed item', pg_temp.sqlstate_of(format(
    $f$select public.reject_competitor_match(%L)$f$, i3)), 'P0002');
  perform public.set_competitor_item_decision(i3, 'wanted');
  if (select decision || '/' || sourcing_status from public.competitor_catalog_items where id = i3) <> 'wanted/to_ask' then
    raise exception 'want';
  end if;
  perform public.update_competitor_sourcing(i3, '  demander à Distrimar ', sup, 'asked');
  if (select sourcing_note || '/' || sourcing_status || '/' || (sourcing_supplier_id = sup)::text
        from public.competitor_catalog_items where id = i3) <> 'demander à Distrimar/asked/true' then
    raise exception 'sourcing';
  end if;
  perform pg_temp.expect('long note', pg_temp.sqlstate_of(format(
    $f$select public.update_competitor_sourcing(%L, repeat('x', 301), null, 'asked')$f$, i3)), '22001');
  perform pg_temp.expect('bad status', pg_temp.sqlstate_of(format(
    $f$select public.update_competitor_sourcing(%L, 'n', null, 'weird')$f$, i3)), '22023');
  perform pg_temp.expect('sourcing on a non wanted item', pg_temp.sqlstate_of(format(
    $f$select public.update_competitor_sourcing(%L, 'n', null, 'asked')$f$, i4)), 'P0002');
  if (select count(*) from public.competitor_catalog_page('wanted')) <> 1
     or (select sourcing_supplier_name from public.competitor_catalog_page('wanted')) <> 'Distrimar' then
    raise exception 'wanted page';
  end if;
  perform public.set_competitor_item_decision(i4, 'ignored');
  if (select count(*) from public.competitor_catalog_page('missing')) <> 0 then raise exception 'ignored item still listed'; end if;
  perform pg_temp.expect('decide a matched item', pg_temp.sqlstate_of(format(
    $f$select public.set_competitor_item_decision(%L, 'wanted')$f$, i1)), 'P0002');
  perform pg_temp.expect('invalid decision', pg_temp.sqlstate_of(format(
    $f$select public.set_competitor_item_decision(%L, 'matched')$f$, i4)), '22023');

  -- a later read does not reset decisions
  execute 'reset role';
  perform public.upsert_competitor_catalog_items(shop, jsonb_build_array(
    jsonb_build_object('external_id', '3', 'name', 'Item three', 'url', 'https://night.example/p/3',
      'price_cents', 4500, 'in_stock', true, 'categories', '[]'::jsonb, 'popularity_rank', 1),
    jsonb_build_object('external_id', '4', 'name', 'Item four', 'url', 'https://night.example/p/4',
      'price_cents', 700, 'categories', '[]'::jsonb, 'popularity_rank', 2)));
  if (select decision || '/' || price_cents from public.competitor_catalog_items where id = i3) <> 'wanted/4500'
     or (select decision from public.competitor_catalog_items where id = i4) <> 'ignored'
     or (select sourcing_note from public.competitor_catalog_items where id = i3) is null then
    raise exception 'a read reset a decision';
  end if;
  -- Finishing the read: items 1 and 2 were not seen since it began.
  update public.competitor_shops set last_sync_started_at = now() - interval '5 seconds' where id = shop;
  update public.competitor_catalog_items set last_seen_at = now() - interval '1 hour' where id in (i1, i2);
  update public.competitor_catalog_items set last_seen_at = now() where id in (i3, i4);
  if public.finish_competitor_shop_read(shop) <> 2 then raise exception 'finish total'; end if;
  if (select count(*) from public.competitor_catalog_items where shop_id = shop and gone) <> 2 then raise exception 'gone'; end if;
  if (select next_page from public.competitor_shops where id = shop) is not null
     or (select status from public.competitor_shops where id = shop) <> 'ok' then
    raise exception 'shop not reset after the read';
  end if;
  -- a gone item that reappears is back
  perform public.upsert_competitor_catalog_items(shop, jsonb_build_array(
    jsonb_build_object('external_id', '2', 'name', 'Sidi Ali 1.5L', 'url', 'https://night.example/p/2',
      'price_cents', 900, 'categories', '[]'::jsonb, 'popularity_rank', 5)));
  if (select gone from public.competitor_catalog_items where id = i2) then raise exception 'gone not cleared'; end if;
  if (select decision from public.competitor_catalog_items where id = i2) <> 'matched' then raise exception 'decision lost'; end if;

  -- recalculation never touches decided items
  v_n := public.apply_competitor_matches(shop, jsonb_build_array(
    jsonb_build_object('item_id', i3, 'product_id', pb, 'score', 0.9, 'uncertain', false),
    jsonb_build_object('item_id', i4, 'product_id', pb, 'score', 0.9, 'uncertain', false)));
  if v_n <> 0 then raise exception 'recalculation touched decided items: %', v_n; end if;

  -- reject goes to missing and stays decided
  update public.competitor_catalog_items set decision = 'proposed', candidate_product_id = pb, match_score = 0.7 where id = i4;
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  perform public.reject_competitor_match(i4);
  if (select decision || '/' || decided_by::text from public.competitor_catalog_items where id = i4) <> 'missing/' || owner_id then
    raise exception 'reject';
  end if;
  execute 'reset role';
  v_n := public.apply_competitor_matches(shop, jsonb_build_array(
    jsonb_build_object('item_id', i4, 'product_id', pb, 'score', 0.9, 'uncertain', false)));
  if v_n <> 0 or (select decision from public.competitor_catalog_items where id = i4) <> 'missing' then
    raise exception 'a refused pair came back';
  end if;

  -- a second chunk of one recalculation (p_reset false) keeps the first chunk's proposals
  insert into public.products (id, name, selling_price_cents, unit) values
    ('52000000-0000-0000-0000-000000000004', 'Extra D', 100, 'piece');
  update public.competitor_catalog_items set decision = 'undecided', decided_by = null where id in (i3, i4);
  perform public.apply_competitor_matches(shop, jsonb_build_array(
    jsonb_build_object('item_id', i3, 'product_id', '52000000-0000-0000-0000-000000000004', 'score', 0.9, 'uncertain', false)), true);
  perform public.apply_competitor_matches(shop, jsonb_build_array(
    jsonb_build_object('item_id', i4, 'product_id', pb, 'score', 0.9, 'uncertain', false)), false);
  if (select count(*) from public.competitor_catalog_items where shop_id = shop and decision = 'proposed') <> 2 then
    raise exception 'the second chunk reset the first';
  end if;
  update public.competitor_catalog_items set decision = 'missing', candidate_product_id = null where id in (i3, i4);

  -- deleting the link (as the owner) un-matches the item
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  delete from public.competitor_links where id = v_link;
  execute 'reset role';
  if (select decision || '/' || coalesce(matched_product_id::text, 'null') || '/' || coalesce(link_id::text, 'null')
        from public.competitor_catalog_items where id = i1) <> 'missing/null/null' then
    raise exception 'link deletion did not un-match the item';
  end if;
  -- a product deleted: candidate set null, a matched item survives
  update public.competitor_catalog_items set decision = 'proposed', candidate_product_id = pb where id = i4;
  delete from public.products where id = pb;
  if (select candidate_product_id from public.competitor_catalog_items where id = i4) is not null then
    raise exception 'candidate not set null';
  end if;
  delete from public.products where id = pc;
  if (select decision from public.competitor_catalog_items where id = i2) <> 'missing' then
    raise exception 'product deletion should un-match through its link';
  end if;
  -- deleting the shop cascades its items but keeps the links that were made
  insert into public.competitor_links (product_id, shop_name, url) values (pa, 'Night', 'https://night.example/keep');
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  delete from public.competitor_shops where id = shop;
  execute 'reset role';
  if (select count(*) from public.competitor_catalog_items where shop_id = shop) <> 0 then raise exception 'items did not cascade'; end if;
  if (select count(*) from public.competitor_links where url = 'https://night.example/keep') <> 1 then raise exception 'shop delete removed a link'; end if;

  ---------------------------------------------------------------- cashier
  insert into public.competitor_shops (id, name, base_url) values (shop, 'Night', 'https://night.example');
  perform public.upsert_competitor_catalog_items(shop, jsonb_build_array(
    jsonb_build_object('external_id', '9', 'name', 'Nine', 'url', 'https://night.example/p/9', 'categories', '[]'::jsonb)));
  perform pg_temp.as_user(cashier_id);
  execute 'set local role authenticated';
  perform pg_temp.expect('cashier shops', pg_temp.count_of('select 1 from public.competitor_shops')::text, '0');
  perform pg_temp.expect('cashier items', pg_temp.count_of('select 1 from public.competitor_catalog_items')::text, '0');
  perform pg_temp.expect('cashier delete shop', pg_temp.sqlstate_of('delete from public.competitor_shops'), null);
  perform pg_temp.expect('cashier overview', pg_temp.sqlstate_of('select * from public.competitor_shop_overview()'), '42501');
  perform pg_temp.expect('cashier counts', pg_temp.sqlstate_of('select * from public.competitor_catalog_counts()'), '42501');
  perform pg_temp.expect('cashier page', pg_temp.sqlstate_of($f$select * from public.competitor_catalog_page('missing')$f$), '42501');
  perform pg_temp.expect('cashier categories', pg_temp.sqlstate_of($f$select * from public.competitor_catalog_categories('missing')$f$), '42501');
  perform pg_temp.expect('cashier confirm', pg_temp.sqlstate_of(format(
    $f$select public.confirm_competitor_match(gen_random_uuid(), %L)$f$, pa)), '42501');
  perform pg_temp.expect('cashier reject', pg_temp.sqlstate_of('select public.reject_competitor_match(gen_random_uuid())'), '42501');
  perform pg_temp.expect('cashier decide', pg_temp.sqlstate_of(
    $f$select public.set_competitor_item_decision(gen_random_uuid(), 'wanted')$f$), '42501');
  perform pg_temp.expect('cashier sourcing', pg_temp.sqlstate_of(
    $f$select public.update_competitor_sourcing(gen_random_uuid(), 'n', null, 'asked')$f$), '42501');
  execute 'reset role';
  if (select count(*) from public.competitor_shops) <> 2 then raise exception 'cashier delete leaked'; end if;

  ---------------------------------------------------------------- anon
  execute 'set local role anon';
  perform pg_temp.expect('anon shops', pg_temp.sqlstate_of('select 1 from public.competitor_shops'), '42501');
  perform pg_temp.expect('anon items', pg_temp.sqlstate_of('select 1 from public.competitor_catalog_items'), '42501');
  perform pg_temp.expect('anon overview', pg_temp.sqlstate_of('select * from public.competitor_shop_overview()'), '42501');
  perform pg_temp.expect('anon page', pg_temp.sqlstate_of($f$select * from public.competitor_catalog_page('missing')$f$), '42501');
  perform pg_temp.expect('anon confirm', pg_temp.sqlstate_of(format(
    $f$select public.confirm_competitor_match(gen_random_uuid(), %L)$f$, pa)), '42501');
  perform pg_temp.expect('anon upsert', pg_temp.sqlstate_of(format(
    $f$select public.upsert_competitor_catalog_items(%L, '[]'::jsonb)$f$, shop)), '42501');
  execute 'reset role';

  -- the schedule function exists, is not callable by the app, and is a no-op without secrets
  perform pg_temp.expect('schedule not for owner', pg_temp.sqlstate_of('select public.schedule_competitor_shop_sync()'), null);
end;
$$;

rollback;
