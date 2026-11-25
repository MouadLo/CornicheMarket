-- Competitor opportunities (migration 061). Runs in CI after `supabase db reset`,
-- as postgres. Every write is rolled back. The seed has an owner 'aa' and a
-- cashier 'bb'.
begin;

insert into public.products (id, name, selling_price_cents, unit, stock_quantity) values
  ('61000000-0000-0000-0000-000000000001', 'Opp A', 1000, 'piece', 100),
  ('61000000-0000-0000-0000-000000000002', 'Opp B', 2000, 'kg', 100);

-- A sale of the last 30 days (the kg product sold in decimals), written as
-- postgres; the sale triggers stamp the cost and move the stock.
insert into public.sales (id, cashier_id, payment_method, discount_cents, total_cents, occurred_at)
values ('61000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000bb', 'cash', 0, 3000, now());
insert into public.sale_items (sale_id, product_id, quantity, unit_price_cents, line_total_cents) values
  ('61000000-0000-0000-0000-0000000000c1', '61000000-0000-0000-0000-000000000001', 2, 1000, 2000),
  ('61000000-0000-0000-0000-0000000000c1', '61000000-0000-0000-0000-000000000002', 0.5, 2000, 1000);

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

do $$
declare
  owner_id constant uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id constant uuid := '00000000-0000-0000-0000-0000000000bb';
  a constant uuid := '61000000-0000-0000-0000-000000000001';
  b constant uuid := '61000000-0000-0000-0000-000000000002';
  l1 constant uuid := '61000000-0000-0000-0000-0000000000a1';
  l2 constant uuid := '61000000-0000-0000-0000-0000000000a2';
begin
  -- Default: not a price-check product.
  if (select price_check from public.products where id = a) is distinct from false then
    raise exception 'price_check should default to false';
  end if;

  ---------------------------------------------------------------- owner
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';

  insert into public.competitor_links (id, product_id, shop_name, url, mode) values
    (l1, a, 'Shop One', 'https://one.example/opp/a', 'auto'),
    (l2, b, 'Shop One', 'https://one.example/opp/b', 'auto');
  insert into public.competitor_price_points (link_id, price_cents, in_stock, source) values
    (l1, 900, true, 'auto'),
    (l2, 2500, true, 'auto');

  update public.products set price_check = true where id = a;
  if (select price_check from public.products where id = a) is distinct from true then
    raise exception 'owner could not set price_check';
  end if;

  if (select price_check from public.competitor_price_overview() where product_id = a) is distinct from true then
    raise exception 'overview should return price_check = true';
  end if;
  if (select price_check from public.competitor_price_overview() where product_id = b) is distinct from false then
    raise exception 'overview should return price_check = false';
  end if;
  if (select sold_30d from public.competitor_price_overview() where product_id = a) <> 2 then
    raise exception 'overview sold_30d for A should be 2, got %',
      (select sold_30d from public.competitor_price_overview() where product_id = a);
  end if;
  if (select sold_30d from public.competitor_price_overview() where product_id = b) <> 0.5 then
    raise exception 'overview sold_30d for B should be 0.5';
  end if;
  -- The owner can untag it again, and a link can be deleted.
  update public.products set price_check = false where id = a;
  delete from public.competitor_links where id = l2;
  if (select count(*) from public.competitor_price_overview()) <> 1 then
    raise exception 'overview should have 1 row after deleting a link';
  end if;
  execute 'reset role';

  ---------------------------------------------------------------- cashier
  perform pg_temp.as_user(cashier_id);
  execute 'set local role authenticated';

  -- Updates are filtered out by the owner-only policy: zero rows change.
  execute format('update public.products set price_check = true where id = %L', a);
  perform pg_temp.expect('cashier overview', pg_temp.sqlstate_of('select * from public.competitor_price_overview()'), '42501');
  if exists (select 1 from information_schema.columns
             where table_name = 'products_cashier_view' and column_name = 'price_check') then
    raise exception 'products_cashier_view exposes price_check';
  end if;
  execute 'reset role';

  if (select price_check from public.products where id = a) is distinct from false then
    raise exception 'cashier changed price_check';
  end if;

  ---------------------------------------------------------------- anon
  execute 'set local role anon';
  perform pg_temp.expect('anon overview', pg_temp.sqlstate_of('select * from public.competitor_price_overview()'), '42501');
  execute 'reset role';
end;
$$;

rollback;
