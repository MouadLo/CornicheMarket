-- Arrange the Sell grid (migration 044). Runs in CI after `supabase db reset`,
-- as postgres. Every write is rolled back. The seed has an owner 'aa' and a
-- cashier 'bb'.
begin;

insert into public.categories (id, name) values
  ('44000000-0000-0000-0000-0000000000c1', 'Arrange Main'),
  ('44000000-0000-0000-0000-0000000000c2', 'Arrange Other');
insert into public.categories (id, name, parent_id) values
  ('44000000-0000-0000-0000-0000000000c3', 'Arrange Sub', '44000000-0000-0000-0000-0000000000c1');
insert into public.products (id, name, selling_price_cents, category_id) values
  ('44000000-0000-0000-0000-000000000001', 'Arr Apple',  100, '44000000-0000-0000-0000-0000000000c1'),
  ('44000000-0000-0000-0000-000000000002', 'Arr Banana', 100, '44000000-0000-0000-0000-0000000000c1'),
  ('44000000-0000-0000-0000-000000000003', 'Arr Cherry', 100, '44000000-0000-0000-0000-0000000000c3'),
  ('44000000-0000-0000-0000-000000000004', 'Arr Milk',   100, '44000000-0000-0000-0000-0000000000c2');

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id uuid := '00000000-0000-0000-0000-0000000000bb';
  apple uuid := '44000000-0000-0000-0000-000000000001';
  banana uuid := '44000000-0000-0000-0000-000000000002';
  cherry uuid := '44000000-0000-0000-0000-000000000003';
  milk uuid := '44000000-0000-0000-0000-000000000004';
  main_tab uuid;
  other_tab uuid;
  fav_tab uuid;
  tabs_json jsonb;
  before_ts timestamptz;
begin
  select id into main_tab from public.sell_grid_tabs where category_id = '44000000-0000-0000-0000-0000000000c1';
  select id into other_tab from public.sell_grid_tabs where category_id = '44000000-0000-0000-0000-0000000000c2';
  select id into fav_tab from public.sell_grid_tabs where kind = 'favorites';
  -- The local seed puts a few products on Favoris; start from an empty tab so
  -- the order checks below see only this test's tiles (rolled back at the end).
  delete from public.sell_grid_tiles where tab_id = fav_tab;

  -- A coloured tile with a short label on the category tab, and two favourites.
  insert into public.sell_grid_tiles (tab_id, product_id, position, color, short_label, pinned)
    values (main_tab, banana, -1, 'red', 'Bana', true);
  insert into public.sell_grid_tiles (tab_id, product_id, position, color)
    values (fav_tab, apple, 0, 'blue'), (fav_tab, milk, 1, null);

  ---------------------------------------------------------------- cashier refused
  perform pg_temp.as_user(cashier_id);
  execute 'set local role authenticated';
  begin
    perform public.save_sell_grid_arrangement('[]'::jsonb, '[]'::jsonb);
    raise exception 'A cashier arranged the grid';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  ---------------------------------------------------------------- owner: category tab order
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  before_ts := (select updated_at from public.sell_grid_tabs where id = main_tab);
  perform public.save_sell_grid_arrangement(
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('tab_id', main_tab, 'product_id', cherry, 'position', 0, 'hidden', false),
      jsonb_build_object('tab_id', main_tab, 'product_id', apple,  'position', 1, 'hidden', false),
      jsonb_build_object('tab_id', main_tab, 'product_id', banana, 'position', 2, 'hidden', false)
    )
  );
  execute 'reset role';
  if (select array_agg(product_id order by position) from public.sell_grid_tiles where tab_id = main_tab)
     is distinct from array[cherry, apple, banana] then
    raise exception 'category tab order was not saved (sub-category product included)';
  end if;
  -- Colour, short label and pinned of an existing row survive.
  if not exists (select 1 from public.sell_grid_tiles
                 where tab_id = main_tab and product_id = banana
                   and color = 'red' and short_label = 'Bana' and pinned) then
    raise exception 'colour, short label or pinned was lost';
  end if;
  if (select updated_at from public.sell_grid_tabs where id = main_tab) <= before_ts then
    raise exception 'the tab updated_at was not bumped';
  end if;

  ---------------------------------------------------------------- owner: Favoris order + hide a tile
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  perform public.save_sell_grid_arrangement(
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('tab_id', fav_tab, 'product_id', milk,  'position', 0, 'hidden', false),
      jsonb_build_object('tab_id', fav_tab, 'product_id', apple, 'position', 1, 'hidden', true)
    )
  );
  execute 'reset role';
  if (select array_agg(product_id order by position) from public.sell_grid_tiles where tab_id = fav_tab)
     is distinct from array[milk, apple] then
    raise exception 'Favoris order was not saved';
  end if;
  if not exists (select 1 from public.sell_grid_tiles
                 where tab_id = fav_tab and product_id = apple and hidden and color = 'blue') then
    raise exception 'hiding a Favoris tile lost its colour or did not hide it';
  end if;

  ---------------------------------------------------------------- owner: reorder and hide tabs
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  perform public.save_sell_grid_arrangement(
    jsonb_build_array(
      jsonb_build_object('id', other_tab, 'position', 0, 'visible', true),
      jsonb_build_object('id', fav_tab, 'position', 1, 'visible', false)
    ),
    '[]'::jsonb
  );
  execute 'reset role';
  if (select position from public.sell_grid_tabs where id = other_tab) <> 0
     or (select position from public.sell_grid_tabs where id = fav_tab) <> 1
     or (select visible from public.sell_grid_tabs where id = fav_tab) then
    raise exception 'tab order or visibility was not saved';
  end if;

  ---------------------------------------------------------------- refusals
  -- Hiding every tab.
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  select jsonb_agg(jsonb_build_object('id', id, 'position', position, 'visible', false))
    into tabs_json from public.sell_grid_tabs;
  begin
    perform public.save_sell_grid_arrangement(tabs_json, '[]'::jsonb);
    raise exception 'Every tab was hidden';
  exception when check_violation then null;
  end;

  -- A product that is not in the tab's category (nor a sub-category).
  begin
    perform public.save_sell_grid_arrangement('[]'::jsonb, jsonb_build_array(
      jsonb_build_object('tab_id', main_tab, 'product_id', milk, 'position', 0, 'hidden', false)));
    raise exception 'A product of another category was accepted on a category tab';
  exception when check_violation then null;
  end;

  -- A tab that does not exist; the same tile twice.
  begin
    perform public.save_sell_grid_arrangement(
      jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'position', 0, 'visible', true)),
      '[]'::jsonb);
    raise exception 'An unknown tab was accepted';
  exception when no_data_found then null;
  end;
  begin
    perform public.save_sell_grid_arrangement('[]'::jsonb, jsonb_build_array(
      jsonb_build_object('tab_id', fav_tab, 'product_id', milk, 'position', 0, 'hidden', false),
      jsonb_build_object('tab_id', fav_tab, 'product_id', milk, 'position', 1, 'hidden', false)));
    raise exception 'The same tile twice was accepted';
  exception when invalid_parameter_value then null;
  end;
  execute 'reset role';

  -- A refused call changed nothing: the whole call is one transaction (the
  -- failing tile comes after a valid tab update in the same call).
  begin
    perform pg_temp.as_user(owner_id);
    execute 'set local role authenticated';
    perform public.save_sell_grid_arrangement(
      jsonb_build_array(jsonb_build_object('id', other_tab, 'position', 99, 'visible', true)),
      jsonb_build_array(jsonb_build_object('tab_id', main_tab, 'product_id', milk, 'position', 0, 'hidden', false)));
    raise exception 'A bad tile was accepted';
  exception when check_violation then null;
  end;
  execute 'reset role';
  if (select position from public.sell_grid_tabs where id = other_tab) = 99 then
    raise exception 'a refused call left its tab change behind';
  end if;
end;
$$;

rollback;
