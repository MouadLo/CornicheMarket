-- Divers in the reports (migration 050). Runs in CI after `supabase db reset`,
-- as postgres. Every write is rolled back. The seed has an owner 'aa' and a
-- cashier 'bb'.
begin;

delete from public.day_closes;
-- Every sale here is dated in 2030, so the figures are exactly what this file made.

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.eq(p_label text, p_got bigint, p_want bigint) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception '%: got %, wanted %', p_label, p_got, p_want;
  end if;
end;
$$;

-- Divers margin 20%: a Divers line of price P is stamped with cost round(P * 0.8).
update public.owner_settings set divers_margin_percent = 20 where singleton;

insert into public.products (id, name, selling_price_cents, current_cost_cents, stock_quantity)
values ('20000000-0000-0000-0000-0000000000d1', 'Divers report regular', 1000, 600, 100);

-- Sales are inserted directly (the triggers stamp cost, estimated flag and
-- discountable exactly as record_sale's insert would).
-- Sale 1 (cash): Divers 10.00 DH + regular 10.00 DH, sale discount 4.00 DH.
-- Divers discountable at 20% margin >= 5% cashier limit, regular margin 40%:
-- both are eligible, discount shared 200 / 200.
insert into public.sales (id, cashier_id, payment_method, discount_cents, total_cents, occurred_at)
values ('30000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000bb', 'cash', 400, 1600, '2030-06-10 12:00+00');
insert into public.sale_items (id, sale_id, product_id, quantity, unit_price_cents, line_total_cents)
select '40000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-0000000000d1', id, 1, 1000, 1000
from public.products where kind = 'misc';
insert into public.sale_items (id, sale_id, product_id, quantity, unit_price_cents, line_total_cents)
values ('40000000-0000-0000-0000-0000000000d2', '30000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', 1, 1000, 1000);

-- Sale 2 (cash): a single Divers line of 25.00 DH, no discount.
insert into public.sales (id, cashier_id, payment_method, discount_cents, total_cents, occurred_at)
values ('30000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000bb', 'cash', 0, 2500, '2030-06-10 15:00+00');
insert into public.sale_items (id, sale_id, product_id, quantity, unit_price_cents, line_total_cents)
select '40000000-0000-0000-0000-0000000000d3', '30000000-0000-0000-0000-0000000000d2', id, 1, 2500, 2500
from public.products where kind = 'misc';

-- Sale 3: voided Divers 99.00 DH, must not count anywhere.
insert into public.sales (id, cashier_id, payment_method, discount_cents, total_cents, occurred_at, voided_at, voided_by)
values ('30000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000bb', 'cash', 0, 9900, '2030-06-10 16:00+00', now(), '00000000-0000-0000-0000-0000000000aa');
insert into public.sale_items (id, sale_id, product_id, quantity, unit_price_cents, line_total_cents)
select '40000000-0000-0000-0000-0000000000d4', '30000000-0000-0000-0000-0000000000d3', id, 1, 9900, 9900
from public.products where kind = 'misc';

-- Sale 4: Divers 7.00 DH on another day (outside the period tested first).
insert into public.sales (id, cashier_id, payment_method, discount_cents, total_cents, occurred_at)
values ('30000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000bb', 'cash', 0, 700, '2030-07-01 12:00+00');
insert into public.sale_items (id, sale_id, product_id, quantity, unit_price_cents, line_total_cents)
select '40000000-0000-0000-0000-0000000000d5', '30000000-0000-0000-0000-0000000000d4', id, 1, 700, 700
from public.products where kind = 'misc';

do $$
declare
  owner_id constant uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id constant uuid := '00000000-0000-0000-0000-0000000000bb';
  r record;
  v_summary bigint;
  v_refused text;
begin
  perform pg_temp.as_user(owner_id);

  -- June 10: Divers lines 10.00 (net 8.00 after its 2.00 share) and 25.00.
  -- Revenue 800 + 2500 = 3300. Cost stamped at 80% of the PRICE: 800 + 2000 = 2800.
  select * into r from public.report_divers('2030-06-10 00:00+00', '2030-06-11 00:00+00');
  perform pg_temp.eq('line_count', r.line_count, 2);
  perform pg_temp.eq('returned_count', r.returned_count, 0);
  perform pg_temp.eq('revenue', r.revenue_cents, 3300);
  perform pg_temp.eq('cost', r.cost_cents, 2800);
  perform pg_temp.eq('profit', r.profit_cents, 500);

  -- The headline revenue still includes Divers: 800 + 2500 + regular (1000 - 200).
  select revenue_cents into v_summary
  from public.report_summary('2030-06-10 00:00+00', '2030-06-11 00:00+00');
  perform pg_temp.eq('summary revenue includes Divers', v_summary, 800 + 2500 + 800);

  -- Divers never appears in the per-product rankings; the regular product does.
  if exists (select 1 from public.report_product_performance('2030-06-10 00:00+00', '2030-06-11 00:00+00') x
             join public.products p on p.id = x.product_id where p.kind = 'misc') then
    raise exception 'report_product_performance returned Divers';
  end if;
  perform pg_temp.eq('regular product still listed',
    (select count(*) from public.report_product_performance('2030-06-10 00:00+00', '2030-06-11 00:00+00')
      where product_id = '20000000-0000-0000-0000-0000000000d1'), 1);

  -- A return of the 25.00 line (the owner returns it in cash): revenue, cost
  -- come back out; the line count stays, returned_count goes to 1.
  perform public.record_sale_return(
    '60000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-0000000000d2',
    jsonb_build_array(jsonb_build_object('sale_item_id', '40000000-0000-0000-0000-0000000000d3', 'quantity', 1)),
    'damaged', null, 'cash');
  select * into r from public.report_divers('2030-06-10 00:00+00', '2030-06-11 00:00+00');
  -- The return is dated now(), outside June 2030: the period is unchanged.
  perform pg_temp.eq('return outside the period: revenue', r.revenue_cents, 3300);
  perform pg_temp.eq('return outside the period: returned_count', r.returned_count, 0);
  -- Move the return into June 10 to see it taken off.
  update public.sale_returns set created_at = '2030-06-10 18:00+00'
  where id = '60000000-0000-0000-0000-0000000000d1';
  select * into r from public.report_divers('2030-06-10 00:00+00', '2030-06-11 00:00+00');
  perform pg_temp.eq('returned line: line_count', r.line_count, 2);
  perform pg_temp.eq('returned line: returned_count', r.returned_count, 1);
  perform pg_temp.eq('returned line: revenue', r.revenue_cents, 800);
  perform pg_temp.eq('returned line: cost', r.cost_cents, 800);
  perform pg_temp.eq('returned line: profit', r.profit_cents, 0);

  -- Both days together include sale 4 (7.00 DH, cost 5.60 -> 560).
  select * into r from public.report_divers('2030-06-01 00:00+00', '2030-08-01 00:00+00');
  perform pg_temp.eq('two days: line_count', r.line_count, 3);
  perform pg_temp.eq('two days: revenue', r.revenue_cents, 800 + 700);
  perform pg_temp.eq('two days: cost', r.cost_cents, 800 + 560);

  -- An empty period gives zeros, not null and not a missing row.
  select * into r from public.report_divers('2031-01-01 00:00+00', '2031-01-02 00:00+00');
  if r is null or r.line_count is distinct from 0 or r.returned_count is distinct from 0
     or r.revenue_cents is distinct from 0 or r.cost_cents is distinct from 0
     or r.profit_cents is distinct from 0 then
    raise exception 'empty period did not return one row of zeros: %', r;
  end if;

  -- A cashier is refused.
  perform pg_temp.as_user(cashier_id);
  begin
    perform * from public.report_divers('2030-06-10 00:00+00', '2030-06-11 00:00+00');
    v_refused := null;
  exception when others then
    v_refused := sqlstate;
  end;
  if v_refused is distinct from '42501' then
    raise exception 'cashier report_divers: got %, wanted 42501', coalesce(v_refused, 'accepted');
  end if;
end $$;

rollback;
