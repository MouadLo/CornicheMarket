-- Webstore catalogue + feed (migration 054). Runs in CI after `supabase db reset`,
-- as postgres. Everything is rolled back. The seed has an owner 'aa' and a cashier 'bb'.
begin;

insert into public.products (id, name, selling_price_cents, current_cost_cents, stock_quantity, unit) values
  ('54000000-0000-0000-0000-000000000001', 'Web test A', 8500, 4000, 5, 'piece'),
  ('54000000-0000-0000-0000-000000000002', 'Web test B', 750, 300, 0, 'piece'),
  ('54000000-0000-0000-0000-000000000003', 'Web test C inactive', 1000, 500, 9, 'piece');
update public.products set active = false where id = '54000000-0000-0000-0000-000000000003';

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
-- The product with this id in the feed, or null.
create function pg_temp.feed_product(p_feed jsonb, p_id text) returns jsonb language sql as $$
  select e from jsonb_array_elements(p_feed -> 'products') e where e ->> 'id' = p_id;
$$;

do $$
declare
  owner_id constant uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id constant uuid := '00000000-0000-0000-0000-0000000000bb';
  pa constant uuid := '54000000-0000-0000-0000-000000000001';
  pb constant uuid := '54000000-0000-0000-0000-000000000002';
  pc constant uuid := '54000000-0000-0000-0000-000000000003';
  v_feed jsonb;
  v_prod jsonb;
  v_v1 bigint;
  v_v2 bigint;
  v_n bigint;
  v_misc uuid;
begin
  ---------------------------------------------------------------- state seeded
  perform pg_temp.expect('version seeded', (select version::text from public.webstore_state), '100');
  perform pg_temp.expect('empty feed has arrays', (select
      (jsonb_typeof(f -> 'categories') || jsonb_typeof(f -> 'products') || jsonb_typeof(f -> 'kits'))
      from (select public.webstore_feed() as f) x), 'arrayarrayarray');

  ---------------------------------------------------------------- owner CRUD
  perform pg_temp.as_user(owner_id);
  set local role authenticated;

  insert into public.web_categories (id, name, name_fr, sort) values
    ('drinks', 'Cold drinks', 'Boissons', 1),
    ('phone', 'Phone', 'Téléphone', 2),
    ('empty', 'Empty', 'Vide', 3);
  insert into public.web_subcategories (category_id, code, name, name_fr, sort) values
    ('drinks', 'Water', 'Water', 'Eau', 1),
    ('drinks', 'Juice, tea & coffee', 'Juice', 'Jus', 2),
    ('drinks', 'Unused', 'Unused', 'Inutilisé', 3),
    ('phone', 'Cables', 'Cables', 'Câbles', 1);
  insert into public.web_products (id, product_id, name, name_fr, size, category_id, sub_code, popular, keywords,
                                   image_url, price_cents, stock_mode, manual_in_stock, published, sort) values
    ('p001', pa, 'Linked A', 'Lié A', '1 m', 'phone', 'Cables', true, 'cable cordon', 'https://img.example/a.jpg', 1, 'auto', true, true, 1),
    ('p002', pb, 'Linked B', null, '', 'drinks', 'Water', false, '', null, null, 'auto', true, true, 2),
    ('p003', null, 'Unlinked 750', 'Libre', null, 'drinks', 'Juice, tea & coffee', false, null, null, 750, 'manual', false, true, 3),
    ('p004', null, 'Unlinked null price', null, null, 'drinks', null, false, null, null, null, 'manual', true, true, 4),
    ('p005', null, 'Unpublished', null, null, 'drinks', 'Unused', false, null, null, 100, 'manual', true, false, 5),
    ('p006', pc, 'Linked inactive', null, null, 'drinks', 'Water', false, null, null, null, 'manual', true, true, 6);
  insert into public.web_kits (id, name, name_fr, sort) values
    ('kit_a', 'Kit A', 'Trousse A', 1),
    ('kit_hidden', 'Unpublished kit', null, 2),
    ('kit_empty', 'Empty kit', null, 3);
  update public.web_kits set published = false where id = 'kit_hidden';
  insert into public.web_kit_items (kit_id, web_product_id, qty, sort) values
    ('kit_a', 'p001', 2, 1), ('kit_a', 'p_gone', 1, 2), ('kit_hidden', 'p001', 1, 1);

  perform pg_temp.expect('owner select categories', (select count(*)::text from public.web_categories), '3');
  perform pg_temp.expect('owner select subs', (select count(*)::text from public.web_subcategories), '4');
  perform pg_temp.expect('owner select products', (select count(*)::text from public.web_products), '6');
  perform pg_temp.expect('owner select kits', (select count(*)::text from public.web_kits), '3');
  perform pg_temp.expect('owner select kit items', (select count(*)::text from public.web_kit_items), '3');
  perform pg_temp.expect('owner reads state', (select count(*)::text from public.webstore_state), '1');
  perform pg_temp.expect('owner cannot write state',
    pg_temp.sqlstate_of('update public.webstore_state set version = 1'), '42501');

  update public.web_categories set name = 'Drinks' where id = 'drinks';
  update public.web_subcategories set name = 'Water!' where code = 'Water';
  update public.web_products set popular = true where id = 'p004';
  update public.web_kits set name = 'Kit A!' where id = 'kit_a';
  update public.web_kit_items set qty = 3 where kit_id = 'kit_a' and web_product_id = 'p_gone';
  perform pg_temp.expect('owner update category', (select name from public.web_categories where id = 'drinks'), 'Drinks');
  perform pg_temp.expect('owner update kit item', (select qty::text from public.web_kit_items where web_product_id = 'p_gone'), '3');
  delete from public.web_kit_items where web_product_id = 'p_gone';
  delete from public.web_kits where id = 'kit_empty';
  delete from public.web_products where id = 'p005';
  delete from public.web_subcategories where code = 'Unused';
  perform pg_temp.expect('owner deleted product', (select count(*)::text from public.web_products where id = 'p005'), '0');
  insert into public.web_kit_items (kit_id, web_product_id, qty, sort) values ('kit_a', 'p_gone', 1, 2);

  ---------------------------------------------------------------- bad data
  perform pg_temp.expect('bad product id',
    pg_temp.sqlstate_of($f$insert into public.web_products (id, name, category_id) values ('bad id!', 'x', 'drinks')$f$), '23514');
  perform pg_temp.expect('product id too long',
    pg_temp.sqlstate_of($f$insert into public.web_products (id, name, category_id) values (repeat('a', 21), 'x', 'drinks')$f$), '23514');
  perform pg_temp.expect('bad category id',
    pg_temp.sqlstate_of($f$insert into public.web_categories (id, name, name_fr) values ('Bad', 'x', 'x')$f$), '23514');
  perform pg_temp.expect('category id starts with digit',
    pg_temp.sqlstate_of($f$insert into public.web_categories (id, name, name_fr) values ('1ab', 'x', 'x')$f$), '23514');
  perform pg_temp.expect('image not https',
    pg_temp.sqlstate_of($f$insert into public.web_products (id, name, category_id, image_url) values ('px', 'x', 'drinks', 'http://a/b.jpg')$f$), '23514');
  perform pg_temp.expect('name too long',
    pg_temp.sqlstate_of($f$insert into public.web_products (id, name, category_id) values ('px', repeat('a', 121), 'drinks')$f$), '23514');
  perform pg_temp.expect('negative price',
    pg_temp.sqlstate_of($f$insert into public.web_products (id, name, category_id, price_cents) values ('px', 'x', 'drinks', -1)$f$), '23514');
  perform pg_temp.expect('qty 11',
    pg_temp.sqlstate_of($f$insert into public.web_kit_items (kit_id, web_product_id, qty) values ('kit_a', 'p003', 11)$f$), '23514');
  perform pg_temp.expect('qty 0',
    pg_temp.sqlstate_of($f$insert into public.web_kit_items (kit_id, web_product_id, qty) values ('kit_a', 'p003', 0)$f$), '23514');
  perform pg_temp.expect('kit name too long',
    pg_temp.sqlstate_of($f$insert into public.web_kits (id, name) values ('kx', repeat('a', 61))$f$), '23514');
  perform pg_temp.expect('auto without link',
    pg_temp.sqlstate_of($f$insert into public.web_products (id, name, category_id, stock_mode) values ('px', 'x', 'drinks', 'auto')$f$), '23514');
  perform pg_temp.expect('bad stock mode',
    pg_temp.sqlstate_of($f$insert into public.web_products (id, name, category_id, stock_mode) values ('px', 'x', 'drinks', 'both')$f$), '23514');
  perform pg_temp.expect('unknown sub',
    pg_temp.sqlstate_of($f$insert into public.web_products (id, name, category_id, sub_code) values ('px', 'x', 'drinks', 'Nope')$f$), '23503');
  perform pg_temp.expect('sub of another category',
    pg_temp.sqlstate_of($f$insert into public.web_products (id, name, category_id, sub_code) values ('px', 'x', 'phone', 'Water')$f$), '23503');
  perform pg_temp.expect('sub code 41 chars',
    pg_temp.sqlstate_of($f$insert into public.web_subcategories (category_id, code, name, name_fr) values ('drinks', repeat('a', 41), 'x', 'x')$f$), '23514');
  perform pg_temp.expect('empty sub code',
    pg_temp.sqlstate_of($f$insert into public.web_subcategories (category_id, code, name, name_fr) values ('drinks', '', 'x', 'x')$f$), '23514');

  ---------------------------------------------------------------- misc cannot be linked
  reset role;
  select id into v_misc from public.products where kind = 'misc';
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  perform pg_temp.expect('link misc on insert',
    pg_temp.sqlstate_of(format($f$insert into public.web_products (id, name, category_id, product_id) values ('pm', 'x', 'drinks', %L)$f$, v_misc)), '23514');
  perform pg_temp.expect('link misc on update',
    pg_temp.sqlstate_of(format($f$update public.web_products set product_id = %L where id = 'p003'$f$, v_misc)), '23514');

  ---------------------------------------------------------------- feed content
  v_feed := public.webstore_feed();
  perform pg_temp.expect('version in feed', v_feed ->> 'version', (select version::text from public.webstore_state));
  perform pg_temp.expect('generated_at format',
    (v_feed ->> 'generated_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')::text, 'true');
  perform pg_temp.expect('category order and unused ones dropped',
    (select string_agg(e ->> 'id', ',') from jsonb_array_elements(v_feed -> 'categories') e), 'drinks,phone');
  perform pg_temp.expect('unused subs dropped, sub shape',
    (select (e -> 'subs')::text from jsonb_array_elements(v_feed -> 'categories') e where e ->> 'id' = 'drinks'),
    '[{"id": "Water", "name": "Water!", "name_fr": "Eau"}, {"id": "Juice, tea & coffee", "name": "Juice", "name_fr": "Jus"}]');
  perform pg_temp.expect('category shape',
    (select (e - 'subs')::text from jsonb_array_elements(v_feed -> 'categories') e where e ->> 'id' = 'phone'),
    '{"id": "phone", "icon": "bag", "name": "Phone", "name_fr": "Téléphone"}');
  perform pg_temp.expect('unpublished excluded', (pg_temp.feed_product(v_feed, 'p005') is null)::text, 'true');
  perform pg_temp.expect('inactive linked excluded', (pg_temp.feed_product(v_feed, 'p006') is null)::text, 'true');
  perform pg_temp.expect('product order (category sort, sort, id)',
    (select string_agg(e ->> 'id', ',') from jsonb_array_elements(v_feed -> 'products') e), 'p002,p003,p004,p001');

  -- linked: the app price wins over the typed 1 cent; 8500 -> 85 (a number, no .00)
  v_prod := pg_temp.feed_product(v_feed, 'p001');
  perform pg_temp.expect('linked price type', jsonb_typeof(v_prod -> 'price'), 'number');
  perform pg_temp.expect('linked price 8500 -> 85', (v_prod -> 'price')::text, '85');
  perform pg_temp.expect('product shape', v_prod::text,
    '{"id": "p001", "cat": "phone", "sub": "Cables", "name": "Linked A", "size": "1 m", "image": "https://img.example/a.jpg", "price": 85, "stock": true, "name_fr": "Lié A", "popular": true, "keywords": "cable cordon"}');
  -- linked 750 -> 7.5; empty/null optional fields come out as null
  v_prod := pg_temp.feed_product(v_feed, 'p002');
  perform pg_temp.expect('linked price 750 -> 7.5', (v_prod -> 'price')::text, '7.5');
  perform pg_temp.expect('auto stock false at 0', (v_prod -> 'stock')::text, 'false');
  perform pg_temp.expect('empty size is null', jsonb_typeof(v_prod -> 'size'), 'null');
  perform pg_temp.expect('empty keywords is null', jsonb_typeof(v_prod -> 'keywords'), 'null');
  perform pg_temp.expect('null name_fr is null', jsonb_typeof(v_prod -> 'name_fr'), 'null');
  perform pg_temp.expect('null image is null', jsonb_typeof(v_prod -> 'image'), 'null');
  -- auto stock true when stock > 0
  perform pg_temp.expect('auto stock true at 5', (pg_temp.feed_product(v_feed, 'p001') -> 'stock')::text, 'true');
  -- unlinked: typed price, manual stock
  v_prod := pg_temp.feed_product(v_feed, 'p003');
  perform pg_temp.expect('unlinked price 750 -> 7.5', (v_prod -> 'price')::text, '7.5');
  perform pg_temp.expect('manual stock false', (v_prod -> 'stock')::text, 'false');
  v_prod := pg_temp.feed_product(v_feed, 'p004');
  perform pg_temp.expect('null price is json null', jsonb_typeof(v_prod -> 'price'), 'null');
  perform pg_temp.expect('manual stock true', (v_prod -> 'stock')::text, 'true');
  perform pg_temp.expect('null sub is null', jsonb_typeof(v_prod -> 'sub'), 'null');

  -- kits: published with items only; a missing product id is still listed
  perform pg_temp.expect('kits', (v_feed -> 'kits')::text,
    '[{"id": "kit_a", "name": "Kit A!", "items": [{"id": "p001", "qty": 2}, {"id": "p_gone", "qty": 1}], "name_fr": "Trousse A"}]');

  -- nothing private in the feed
  perform pg_temp.expect('no private words',
    (v_feed::text ~* '(cost|stock_quantity|current_cost|profit)')::text, 'false');

  ---------------------------------------------------------------- feed follows the app product
  reset role;
  update public.products set stock_quantity = 0 where id = pa;
  update public.products set stock_quantity = 3, selling_price_cents = 1250 where id = pb;
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  v_feed := public.webstore_feed();
  perform pg_temp.expect('auto stock false after sell-out', (pg_temp.feed_product(v_feed, 'p001') -> 'stock')::text, 'false');
  perform pg_temp.expect('auto stock true after receiving', (pg_temp.feed_product(v_feed, 'p002') -> 'stock')::text, 'true');
  perform pg_temp.expect('price follows selling price', (pg_temp.feed_product(v_feed, 'p002') -> 'price')::text, '12.5');
  perform pg_temp.expect('shop price change does not hide product', (pg_temp.feed_product(v_feed, 'p001') is not null)::text, 'true');
  reset role;
  update public.products set active = false where id = pa;
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  perform pg_temp.expect('product deactivated in app leaves the feed',
    (pg_temp.feed_product(public.webstore_feed(), 'p001') is null)::text, 'true');

  ---------------------------------------------------------------- version
  select version into v_v1 from public.webstore_state;
  update public.web_products set popular = not popular where id = 'p004';
  select version into v_v2 from public.webstore_state;
  perform pg_temp.expect('version +1 on update', (v_v2 - v_v1)::text, '1');
  update public.web_products set popular = popular where id in ('p001', 'p002', 'p003');
  select version into v_v1 from public.webstore_state;
  perform pg_temp.expect('version +1 per statement, not per row', (v_v1 - v_v2)::text, '1');
  insert into public.web_kit_items (kit_id, web_product_id, qty) values ('kit_a', 'p004', 1);
  perform pg_temp.expect('version bumps on kit item insert',
    ((select version from public.webstore_state) - v_v1)::text, '1');

  ---------------------------------------------------------------- deleting the linked app product
  reset role;
  update public.products set active = true where id = pa;
  delete from public.products where id = pb;
  perform pg_temp.expect('auto row falls back to manual',
    (select stock_mode || ':' || coalesce(product_id::text, 'null') from public.web_products where id = 'p002'), 'manual:null');
  update public.web_products set product_id = null where id = 'p001';
  perform pg_temp.expect('unlinking resets auto to manual',
    (select stock_mode from public.web_products where id = 'p001'), 'manual');
  perform pg_temp.expect('still cannot ask for auto without a link',
    pg_temp.sqlstate_of($f$update public.web_products set stock_mode = 'auto' where id = 'p001'$f$), '23514');

  ---------------------------------------------------------------- cashier
  perform pg_temp.as_user(cashier_id);
  set local role authenticated;
  perform pg_temp.expect('cashier sees no categories', (select count(*)::text from public.web_categories), '0');
  perform pg_temp.expect('cashier sees no subs', (select count(*)::text from public.web_subcategories), '0');
  perform pg_temp.expect('cashier sees no products', (select count(*)::text from public.web_products), '0');
  perform pg_temp.expect('cashier sees no kits', (select count(*)::text from public.web_kits), '0');
  perform pg_temp.expect('cashier sees no kit items', (select count(*)::text from public.web_kit_items), '0');
  perform pg_temp.expect('cashier sees no state', (select count(*)::text from public.webstore_state), '0');
  perform pg_temp.expect('cashier cannot insert category',
    pg_temp.sqlstate_of($f$insert into public.web_categories (id, name, name_fr) values ('cash', 'x', 'x')$f$), '42501');
  perform pg_temp.expect('cashier cannot insert product',
    pg_temp.sqlstate_of($f$insert into public.web_products (id, name, category_id) values ('pc1', 'x', 'drinks')$f$), '42501');
  perform pg_temp.expect('cashier cannot insert kit',
    pg_temp.sqlstate_of($f$insert into public.web_kits (id, name) values ('kc', 'x')$f$), '42501');
  update public.web_products set name = 'hacked';
  get diagnostics v_n = row_count;
  perform pg_temp.expect('cashier update touches nothing', v_n::text, '0');
  delete from public.web_categories;
  get diagnostics v_n = row_count;
  perform pg_temp.expect('cashier delete touches nothing', v_n::text, '0');
  perform pg_temp.expect('cashier cannot read the feed', pg_temp.sqlstate_of('select public.webstore_feed()'), '42501');

  ---------------------------------------------------------------- anon
  reset role;
  set local role anon;
  perform pg_temp.expect('anon cannot read categories', pg_temp.sqlstate_of('select * from public.web_categories'), '42501');
  perform pg_temp.expect('anon cannot read products', pg_temp.sqlstate_of('select * from public.web_products'), '42501');
  perform pg_temp.expect('anon cannot read state', pg_temp.sqlstate_of('select * from public.webstore_state'), '42501');
  perform pg_temp.expect('anon cannot insert',
    pg_temp.sqlstate_of($f$insert into public.web_kits (id, name) values ('ka', 'x')$f$), '42501');
  perform pg_temp.expect('anon cannot call the feed', pg_temp.sqlstate_of('select public.webstore_feed()'), '42501');

  ---------------------------------------------------------------- service role (the edge function)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  v_feed := public.webstore_feed();
  perform pg_temp.expect('service role gets the feed', jsonb_typeof(v_feed -> 'products'), 'array');
end $$;

rollback;
