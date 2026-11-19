-- Cashier discount limit (migration 041). Runs in CI after `supabase db reset`,
-- as postgres. Every write is rolled back. The seed has an owner 'aa' and a
-- cashier 'bb'.
begin;

insert into public.products (id, name, selling_price_cents, current_cost_cents, stock_quantity)
values
  ('41000000-0000-0000-0000-000000000001', 'Disc high margin', 1000, 500, 1000),
  ('41000000-0000-0000-0000-000000000002', 'Disc low margin 4pct', 1000, 960, 1000),
  ('41000000-0000-0000-0000-000000000003', 'Disc margin exactly 5pct', 1000, 950, 1000),
  ('41000000-0000-0000-0000-000000000004', 'Disc no cost', 1000, 0, 1000);
insert into public.products (id, name, selling_price_cents, current_cost_cents, stock_quantity, discount_override)
values
  ('41000000-0000-0000-0000-000000000005', 'Disc forced allow', 1000, 990, 1000, 'allow'),
  ('41000000-0000-0000-0000-000000000006', 'Disc forced block', 1000, 100, 1000, 'block');

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id uuid := '00000000-0000-0000-0000-0000000000bb';
  hi uuid := '41000000-0000-0000-0000-000000000001';
  lo uuid := '41000000-0000-0000-0000-000000000002';
  edge uuid := '41000000-0000-0000-0000-000000000003';
  nocost uuid := '41000000-0000-0000-0000-000000000004';
  allowed uuid := '41000000-0000-0000-0000-000000000005';
  blocked uuid := '41000000-0000-0000-0000-000000000006';
  divers uuid;
  s public.store_settings;
  n int;
  v boolean;
  d jsonb;
  a bigint;
  cnt int;

  -- Sale rung up by the given user; returns nothing, checks are done by caller.
  -- p_lines: [{"product_id":..,"quantity":..,"unit_price_cents":..,"discount_cents":..}]
begin
  select * into s from public.store_settings;
  if s.cashier_discount_percent <> 5 or s.cashier_discount_max_cents <> 2000 then
    raise exception 'wrong defaults: % %', s.cashier_discount_percent, s.cashier_discount_max_cents;
  end if;
  select id into divers from public.products where kind = 'misc';

  ---------------------------------------------------------------- discountable()
  if not (select public.discountable(p) from public.products p where id = hi) then raise exception 'high margin should be discountable'; end if;
  if (select public.discountable(p) from public.products p where id = lo) then raise exception '4 pct margin should not be discountable'; end if;
  if not (select public.discountable(p) from public.products p where id = edge) then raise exception 'exactly 5 pct margin should be discountable'; end if;
  if (select public.discountable(p) from public.products p where id = nocost) then raise exception 'no cost should not be discountable'; end if;
  if not (select public.discountable(p) from public.products p where id = allowed) then raise exception 'override allow should win'; end if;
  if (select public.discountable(p) from public.products p where id = divers) is not true then raise exception 'divers (20 pct default margin) should be discountable'; end if;
  if (select public.discountable(p) from public.products p where id = blocked) then raise exception 'override block should win'; end if;

  update public.owner_settings set divers_margin_percent = 3;
  if (select public.discountable(p) from public.products p where id = divers) then raise exception 'divers at 3 pct margin should not be discountable'; end if;
  update public.owner_settings set divers_margin_percent = 20;

  -- The limit percent moves the threshold: at 3 pct the 4 pct item qualifies.
  update public.store_settings set cashier_discount_percent = 3;
  if not (select public.discountable(p) from public.products p where id = lo) then raise exception '4 pct margin should pass a 3 pct limit'; end if;
  update public.store_settings set cashier_discount_percent = 5;

  ---------------------------------------------------------------- cashier view
  perform pg_temp.as_user(cashier_id);
  execute 'set local role authenticated';
  select count(*) into cnt from public.products_cashier_view where id in (hi, lo, edge, nocost, allowed, blocked);
  if cnt <> 6 then raise exception 'cashier view should list the 6 products, got %', cnt; end if;
  if (select discountable from public.products_cashier_view where id = hi) is not true
     or (select discountable from public.products_cashier_view where id = lo) is not false
     or (select discountable from public.products_cashier_view where id = blocked) is not false then
    raise exception 'cashier view discountable is wrong';
  end if;
  -- A cashier cannot change the override (no policy / grant), nor read it or the cost.
  begin
    update public.products set discount_override = 'allow' where id = lo;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'cashier changed a product override'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    perform discount_override from public.products_cashier_view limit 1;
    raise exception 'cashier view should not expose discount_override';
  exception when undefined_column then null;
  end;
  begin
    update public.store_settings set cashier_discount_percent = 100;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'cashier changed the discount limit'; end if;
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  if (select cashier_discount_percent from public.store_settings) <> 5 then raise exception 'limit was changed by a cashier'; end if;

  -- The owner can change them.
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  update public.products set discount_override = 'block' where id = hi;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'owner could not set the override'; end if;
  update public.products set discount_override = null where id = hi;
  update public.store_settings set cashier_discount_percent = 5, cashier_discount_max_cents = 2000;
  if (select public.discountable(p) from public.products p where id = hi) is not true then raise exception 'owner computed column discountable'; end if;
  execute 'reset role';

  ---------------------------------------------------------------- record_sale as cashier
  perform pg_temp.as_user(cashier_id);
  execute 'set local role authenticated';

  -- S1: 2 x 1000, sale discount 100 = exactly 5 pct: fine.
  perform public.record_sale('41100000-0000-0000-0000-000000000001', null, 'cash', 100,
    jsonb_build_array(jsonb_build_object('product_id', hi, 'quantity', 2, 'unit_price_cents', 1000)), now());
  -- S2: 101: over the percent.
  perform public.record_sale('41100000-0000-0000-0000-000000000002', null, 'cash', 101,
    jsonb_build_array(jsonb_build_object('product_id', hi, 'quantity', 2, 'unit_price_cents', 1000)), now());
  -- S3: big basket 100 x 1000: 5 pct = 5000 but the ceiling is 2000: 2000 fine.
  perform public.record_sale('41100000-0000-0000-0000-000000000003', null, 'cash', 2000,
    jsonb_build_array(jsonb_build_object('product_id', hi, 'quantity', 100, 'unit_price_cents', 1000)), now());
  -- S3b: 2001: over the ceiling although under 5 pct.
  perform public.record_sale('41100000-0000-0000-0000-000000000004', null, 'cash', 2001,
    jsonb_build_array(jsonb_build_object('product_id', hi, 'quantity', 100, 'unit_price_cents', 1000)), now());
  -- S4: a line discount on a non-discountable product (plus a good line).
  perform public.record_sale('41100000-0000-0000-0000-000000000005', null, 'cash', 0,
    jsonb_build_array(
      jsonb_build_object('product_id', hi, 'quantity', 10, 'unit_price_cents', 1000),
      jsonb_build_object('product_id', lo, 'quantity', 1, 'unit_price_cents', 1000, 'discount_cents', 10)), now());
  -- S5: line discount 30 + sale discount 30 on 1000: together 60 > 50.
  perform public.record_sale('41100000-0000-0000-0000-000000000006', null, 'cash', 30,
    jsonb_build_array(jsonb_build_object('product_id', hi, 'quantity', 1, 'unit_price_cents', 1000, 'discount_cents', 30)), now());
  -- S6: mixed basket; only the discountable 1000 counts: limit 50, discount 50: fine.
  perform public.record_sale('41100000-0000-0000-0000-000000000007', null, 'cash', 50,
    jsonb_build_array(
      jsonb_build_object('product_id', hi, 'quantity', 1, 'unit_price_cents', 1000),
      jsonb_build_object('product_id', lo, 'quantity', 1, 'unit_price_cents', 1000)), now());
  -- S7: the same basket with 51: flagged (the low-margin line adds nothing to the limit).
  perform public.record_sale('41100000-0000-0000-0000-000000000008', null, 'cash', 51,
    jsonb_build_array(
      jsonb_build_object('product_id', hi, 'quantity', 1, 'unit_price_cents', 1000),
      jsonb_build_object('product_id', lo, 'quantity', 1, 'unit_price_cents', 1000)), now());
  -- S8: only blocked lines: any sale discount is over (limit 0).
  perform public.record_sale('41100000-0000-0000-0000-000000000009', null, 'cash', 1,
    jsonb_build_array(jsonb_build_object('product_id', lo, 'quantity', 1, 'unit_price_cents', 1000)), now());
  -- S9: no discount at all, not flagged.
  perform public.record_sale('41100000-0000-0000-0000-00000000000a', null, 'cash', 0,
    jsonb_build_array(jsonb_build_object('product_id', lo, 'quantity', 1, 'unit_price_cents', 1000)), now());
  execute 'reset role';

  -- Flags (a 10 pct "over threshold" rule also exists; only the new action counts here).
  foreach d in array array[
    '"41100000-0000-0000-0000-000000000001"'::jsonb, '"41100000-0000-0000-0000-000000000003"',
    '"41100000-0000-0000-0000-000000000007"', '"41100000-0000-0000-0000-00000000000a"'] loop
    if exists (select 1 from public.activity_log where action = 'discount_over_cashier_limit' and entity_id = (d #>> '{}')::uuid) then
      raise exception 'sale % must not be flagged', d;
    end if;
  end loop;
  foreach d in array array[
    '"41100000-0000-0000-0000-000000000002"'::jsonb, '"41100000-0000-0000-0000-000000000004"',
    '"41100000-0000-0000-0000-000000000005"', '"41100000-0000-0000-0000-000000000006"',
    '"41100000-0000-0000-0000-000000000008"', '"41100000-0000-0000-0000-000000000009"'] loop
    if not exists (select 1 from public.activity_log where action = 'discount_over_cashier_limit' and entity_id = (d #>> '{}')::uuid)
       or not (select needs_discount_review from public.sales where id = (d #>> '{}')::uuid) then
      raise exception 'sale % must be flagged', d;
    end if;
  end loop;

  select details into d from public.activity_log
   where action = 'discount_over_cashier_limit' and entity_id = '41100000-0000-0000-0000-000000000002';
  if (d ->> 'limit_cents')::bigint <> 100 or (d ->> 'total_discount_cents')::bigint <> 101
     or (d ->> 'percent')::numeric <> 5 or (d ->> 'max_cents')::bigint <> 2000
     or jsonb_array_length(d -> 'blocked_lines') <> 0
     or (select actor_id from public.activity_log where action = 'discount_over_cashier_limit'
          and entity_id = '41100000-0000-0000-0000-000000000002') <> cashier_id then
    raise exception 'wrong S2 details: %', d;
  end if;
  select details into d from public.activity_log
   where action = 'discount_over_cashier_limit' and entity_id = '41100000-0000-0000-0000-000000000004';
  if (d ->> 'limit_cents')::bigint <> 2000 then raise exception 'ceiling not applied: %', d; end if;
  select details into d from public.activity_log
   where action = 'discount_over_cashier_limit' and entity_id = '41100000-0000-0000-0000-000000000005';
  if (d -> 'blocked_lines' -> 0 ->> 'product_id')::uuid <> lo or (d -> 'blocked_lines' -> 0 ->> 'discount_cents')::bigint <> 10 then
    raise exception 'blocked line not reported: %', d;
  end if;
  -- The sale is still recorded when flagged.
  if (select total_cents from public.sales where id = '41100000-0000-0000-0000-000000000002') <> 1899 then
    raise exception 'a flagged sale must still be recorded';
  end if;

  ---------------------------------------------------------------- owner has no limit
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  perform public.record_sale('41100000-0000-0000-0000-00000000000b', null, 'cash', 500,
    jsonb_build_array(jsonb_build_object('product_id', lo, 'quantity', 1, 'unit_price_cents', 1000)), now());
  perform public.record_sale('41100000-0000-0000-0000-00000000000c', null, 'cash', 0,
    jsonb_build_array(jsonb_build_object('product_id', lo, 'quantity', 1, 'unit_price_cents', 1000, 'discount_cents', 200)), now());
  execute 'reset role';
  if exists (select 1 from public.activity_log where action = 'discount_over_cashier_limit'
             and entity_id in ('41100000-0000-0000-0000-00000000000b', '41100000-0000-0000-0000-00000000000c')) then
    raise exception 'an owner sale must not be flagged by the cashier limit';
  end if;

  ---------------------------------------------------------------- stamped on sale_items
  if (select bool_or(discountable) from public.sale_items
       where sale_id = '41100000-0000-0000-0000-000000000005' and product_id = lo) then
    raise exception 'low-margin line must be stamped not discountable';
  end if;
  if not (select bool_and(discountable) from public.sale_items
       where sale_id = '41100000-0000-0000-0000-000000000005' and product_id = hi) then
    raise exception 'high-margin line must be stamped discountable';
  end if;
  -- A value sent by the client is overwritten.
  insert into public.sale_items (sale_id, product_id, quantity, unit_price_cents, discount_cents, discountable)
  values ('41100000-0000-0000-0000-00000000000a', hi, 1, 1000, 0, false);
  if not (select discountable from public.sale_items
           where sale_id = '41100000-0000-0000-0000-00000000000a' and product_id = hi) then
    raise exception 'client-sent discountable must be overwritten';
  end if;
  delete from public.sale_items where sale_id = '41100000-0000-0000-0000-00000000000a' and product_id = hi;

  ---------------------------------------------------------------- report allocation
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  -- S6 (id ...07): 50 sale discount goes entirely to the discountable line.
  select allocated_discount_cents into a from public.sale_line_economics
   where sale_id = '41100000-0000-0000-0000-000000000007' and product_id = hi;
  if a <> 50 then raise exception 'discount should all land on the discountable line, got %', a; end if;
  select allocated_discount_cents into a from public.sale_line_economics
   where sale_id = '41100000-0000-0000-0000-000000000007' and product_id = lo;
  if a <> 0 then raise exception 'non-discountable line must get none, got %', a; end if;
  -- The sum always equals the sale discount.
  if (select sum(allocated_discount_cents) from public.sale_line_economics
       where sale_id = '41100000-0000-0000-0000-000000000008') <> 51 then
    raise exception 'allocation must sum to the sale discount';
  end if;
  -- Owner sale with only non-discountable lines: spread over all of them (as before).
  select allocated_discount_cents into a from public.sale_line_economics
   where sale_id = '41100000-0000-0000-0000-00000000000b';
  if a <> 500 then raise exception 'fallback allocation should give 500, got %', a; end if;
  execute 'reset role';
end;
$$;

rollback;
