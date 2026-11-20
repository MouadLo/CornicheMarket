-- Item returns (migration 046). Runs in CI after `supabase db reset`, as postgres.
-- Every write is rolled back.
begin;

-- Several checks count every return in the table. Start from none, whatever a
-- local database already holds (rolled back with the rest at the end).
delete from public.sale_return_items;
delete from public.sale_returns;

-- Start from no closed day (a developer's local database may have one).
delete from public.day_closes;

-- A second cashier (the seed has an owner 'aa' and a cashier 'bb').
insert into auth.users (id, email, instance_id, aud, role)
values ('00000000-0000-0000-0000-0000000000cc', 'cashier2-returns@example.test',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
on conflict (id) do nothing;
insert into public.profiles (id, full_name, role)
values ('00000000-0000-0000-0000-0000000000cc', 'Second cashier', 'cashier')
on conflict (id) do nothing;

insert into public.customers (id, name) values ('00000000-0000-0000-0000-0000000000d9', 'Returns test client');

-- P1: a piece product costing 6.00 DH to buy. P2: another piece product.
-- P3: sold by weight.
insert into public.products (id, name, selling_price_cents, current_cost_cents, stock_quantity)
values
  ('20000000-0000-0000-0000-000000000011', 'Return product 1', 1000, 600, 10),
  ('20000000-0000-0000-0000-000000000012', 'Return product 2', 500, 300, 10);
insert into public.products (id, name, unit, selling_price_cents, current_cost_cents, stock_quantity)
values ('20000000-0000-0000-0000-000000000013', 'Return product kg', 'kg', 2000, 1200, 10);

-- Sale A (cash, cashier bb): 3 x P1 (3000) + 1 x P2 (500), sale discount 400,
-- total 3100. The 400 is shared 343 / 57 (largest remainder), so the customer
-- paid 2657 for the P1 line and 443 for the P2 line.
insert into public.sales (id, cashier_id, payment_method, discount_cents, total_cents, occurred_at)
values ('30000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000bb', 'cash', 400, 3100, now());
insert into public.sale_items (id, sale_id, product_id, quantity, unit_price_cents, line_total_cents)
values
  ('40000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000011', 3, 1000, 3000),
  ('40000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000012', 1, 500, 500);

-- Sale B (cash, bb): already voided.
insert into public.sales (id, cashier_id, payment_method, discount_cents, total_cents, occurred_at, voided_at, voided_by)
values ('30000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000bb', 'cash', 0, 1000, now(), now(), '00000000-0000-0000-0000-0000000000aa');
insert into public.sale_items (id, sale_id, product_id, quantity, unit_price_cents, line_total_cents)
values ('40000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000011', 1, 1000, 1000);

-- Sale C (credit, bb, for the test client): 2 x P1 = 2000.
insert into public.sales (id, cashier_id, customer_id, payment_method, discount_cents, total_cents, occurred_at)
values ('30000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000d9', 'credit', 0, 2000, now());
insert into public.sale_items (id, sale_id, product_id, quantity, unit_price_cents, line_total_cents)
values ('40000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-000000000011', 2, 1000, 2000);

-- Sale E (card, bb): from a day that gets closed, 1 x P2 = 500.
insert into public.sales (id, cashier_id, payment_method, discount_cents, total_cents, occurred_at)
values ('30000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000bb', 'card', 0, 500, '2020-03-10 12:00+00');
insert into public.sale_items (id, sale_id, product_id, quantity, unit_price_cents, line_total_cents)
values ('40000000-0000-0000-0000-0000000000e1', '30000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-000000000012', 1, 500, 500);

-- Sale F (cash, bb): 1.250 kg at 20.00 DH = 2500.
insert into public.sales (id, cashier_id, payment_method, discount_cents, total_cents, occurred_at)
values ('30000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000bb', 'cash', 0, 2500, now());
insert into public.sale_items (id, sale_id, product_id, quantity, unit_price_cents, line_total_cents)
values ('40000000-0000-0000-0000-0000000000f1', '30000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-000000000013', 1.250, 2000, 2500);

-- Sale G (cash, bb): never returned; used for the closed-today refusal.
insert into public.sales (id, cashier_id, payment_method, discount_cents, total_cents, occurred_at)
values ('30000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000bb', 'cash', 0, 1000, now());
insert into public.sale_items (id, sale_id, product_id, quantity, unit_price_cents, line_total_cents)
values ('40000000-0000-0000-0000-0000000000a7', '30000000-0000-0000-0000-0000000000a7', '20000000-0000-0000-0000-000000000011', 1, 1000, 1000);

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  bb uuid := '00000000-0000-0000-0000-0000000000bb';
  cc uuid := '00000000-0000-0000-0000-0000000000cc';
  sale_a uuid := '30000000-0000-0000-0000-0000000000a1';
  sale_b uuid := '30000000-0000-0000-0000-0000000000b1';
  sale_c uuid := '30000000-0000-0000-0000-0000000000c1';
  sale_e uuid := '30000000-0000-0000-0000-0000000000e1';
  sale_f uuid := '30000000-0000-0000-0000-0000000000f1';
  sale_g uuid := '30000000-0000-0000-0000-0000000000a7';
  line_a1 uuid := '40000000-0000-0000-0000-0000000000a1';
  line_a2 uuid := '40000000-0000-0000-0000-0000000000a2';
  line_b1 uuid := '40000000-0000-0000-0000-0000000000b1';
  line_c1 uuid := '40000000-0000-0000-0000-0000000000c1';
  line_e1 uuid := '40000000-0000-0000-0000-0000000000e1';
  line_f1 uuid := '40000000-0000-0000-0000-0000000000f1';
  line_g1 uuid := '40000000-0000-0000-0000-0000000000a7';
  p1 uuid := '20000000-0000-0000-0000-000000000011';
  p2 uuid := '20000000-0000-0000-0000-000000000012';
  p3 uuid := '20000000-0000-0000-0000-000000000013';
  client uuid := '00000000-0000-0000-0000-0000000000d9';
  r1 uuid := '50000000-0000-0000-0000-000000000001';
  r2 uuid := '50000000-0000-0000-0000-000000000002';
  r3 uuid := '50000000-0000-0000-0000-000000000003';
  r4 uuid := '50000000-0000-0000-0000-000000000004';
  r5 uuid := '50000000-0000-0000-0000-000000000005';
  r6 uuid := '50000000-0000-0000-0000-000000000006';
  r7 uuid := '50000000-0000-0000-0000-000000000007';
  r8 uuid := '50000000-0000-0000-0000-000000000008';
  stock_before numeric;
  stock_after numeric;
  n int;
  v bigint;
  cost_before bigint;
  rev_before bigint;
  cogs_before bigint;
  rev_after bigint;
  cogs_after bigint;
  refunded_total bigint;
  returned_cost bigint;
  sum_expected bigint;
  qty_before numeric;
  qty_after numeric;
  js jsonb;
  c jsonb;
  closed public.day_closes;
begin
  select current_cost_cents into cost_before from public.products where id = p1;

  -- Baseline report figures (owner), before any return.
  perform pg_temp.as_user(owner_id);
  select revenue_cents, cogs_cents into rev_before, cogs_before
  from public.report_summary(now() - interval '1 day', now() + interval '1 day');
  select coalesce(sum(quantity), 0) into qty_before
  from public.report_product_performance(now() - interval '1 day', now() + interval '1 day')
  where product_id = p1;

  ------------------------------------------------------------ cashier: refused
  perform pg_temp.as_user(bb);
  begin
    perform public.record_sale_return(r1, sale_a,
      jsonb_build_array(jsonb_build_object('sale_item_id', line_a1, 'quantity', 1)),
      'wrong_item', null, 'cash');
    raise exception 'a cashier recorded a return';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.returnable_sale_lines(sale_a);
    raise exception 'a cashier read the returnable lines';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.sale_returns) then
    raise exception 'a refused return left a row behind';
  end if;

  ----------------------------------------------- owner: return 1 of 3 (cash)
  perform pg_temp.as_user(owner_id);
  select stock_quantity into stock_before from public.products where id = p1;

  -- What the sheet shows before any return: paid 2657 for the P1 line.
  select paid_cents into v from public.returnable_sale_lines(sale_a) where sale_item_id = line_a1;
  if v <> 2657 then raise exception 'paid for line A1 should be 2657, got %', v; end if;
  select paid_cents into v from public.returnable_sale_lines(sale_a) where sale_item_id = line_a2;
  if v <> 443 then raise exception 'paid for line A2 should be 443, got %', v; end if;

  if public.record_sale_return(r1, sale_a,
       jsonb_build_array(jsonb_build_object('sale_item_id', line_a1, 'quantity', 1)),
       'customer_changed_mind', 'brought it back', 'cash') <> r1 then
    raise exception 'record_sale_return did not return the id';
  end if;

  select stock_quantity into stock_after from public.products where id = p1;
  if stock_after <> stock_before + 1 then
    raise exception 'stock should be +1: % -> %', stock_before, stock_after;
  end if;
  -- Average cost untouched (as a void leaves it).
  if (select current_cost_cents from public.products where id = p1) <> cost_before then
    raise exception 'a return changed the average cost';
  end if;
  -- round(2657 / 3) = 886 (885.67): the paid share including the sale discount.
  select refund_cents into v from public.sale_returns where id = r1;
  if v <> 886 then raise exception 'refund for 1 of 3 should be 886, got %', v; end if;
  select refund_cents, unit_cost_cents into v, cost_before from public.sale_return_items where return_id = r1;
  if v <> 886 or cost_before <> 600 then
    raise exception 'return item should carry 886 and the stamped cost 600, got % / %', v, cost_before;
  end if;
  select current_cost_cents into cost_before from public.products where id = p1;
  if (select count(*) from public.activity_log where action = 'sale_returned' and entity_id = sale_a) <> 1 then
    raise exception 'sale_returned was not logged once';
  end if;

  -- Idempotent replay: nothing added twice.
  perform public.record_sale_return(r1, sale_a,
    jsonb_build_array(jsonb_build_object('sale_item_id', line_a1, 'quantity', 1)),
    'customer_changed_mind', 'brought it back', 'cash');
  select count(*) into n from public.sale_returns where sale_id = sale_a;
  if n <> 1 then raise exception 'replay added a return: %', n; end if;
  if (select stock_quantity from public.products where id = p1) <> stock_after then
    raise exception 'replay put the stock back twice';
  end if;
  if (select count(*) from public.activity_log where action = 'sale_returned' and entity_id = sale_a) <> 1 then
    raise exception 'replay logged again';
  end if;
  -- The same id on another sale is refused, not silently ignored.
  begin
    perform public.record_sale_return(r1, sale_g,
      jsonb_build_array(jsonb_build_object('sale_item_id', line_g1, 'quantity', 1)),
      'wrong_item', null, 'cash');
    raise exception 'a return id was reused for another sale';
  exception when invalid_parameter_value then null;
  end;

  ------------------------------------------------------------- refusals
  -- More than what remains (2 left of 3).
  begin
    perform public.record_sale_return(r2, sale_a,
      jsonb_build_array(jsonb_build_object('sale_item_id', line_a1, 'quantity', 3)),
      'wrong_item', null, 'cash');
    raise exception 'returned more than remained';
  exception when invalid_parameter_value then null;
  end;
  -- Zero, negative and over-precise quantities.
  begin
    perform public.record_sale_return(r2, sale_a,
      jsonb_build_array(jsonb_build_object('sale_item_id', line_a1, 'quantity', 0)),
      'wrong_item', null, 'cash');
    raise exception 'returned zero';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.record_sale_return(r2, sale_a,
      jsonb_build_array(jsonb_build_object('sale_item_id', line_a1, 'quantity', 0.0004)),
      'wrong_item', null, 'cash');
    raise exception 'returned a sub-gram quantity';
  exception when invalid_parameter_value then null;
  end;
  -- Unknown reason, "other" without a note, an unknown method, no lines.
  begin
    perform public.record_sale_return(r2, sale_a,
      jsonb_build_array(jsonb_build_object('sale_item_id', line_a1, 'quantity', 1)),
      'because', null, 'cash');
    raise exception 'unknown reason accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.record_sale_return(r2, sale_a,
      jsonb_build_array(jsonb_build_object('sale_item_id', line_a1, 'quantity', 1)),
      'other', '  ', 'cash');
    raise exception 'other without a note accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.record_sale_return(r2, sale_a,
      jsonb_build_array(jsonb_build_object('sale_item_id', line_a1, 'quantity', 1)),
      'wrong_item', null, 'cheque');
    raise exception 'unknown method accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.record_sale_return(r2, sale_a, '[]'::jsonb, 'wrong_item', null, 'cash');
    raise exception 'empty return accepted';
  exception when invalid_parameter_value then null;
  end;
  -- A cash sale is not refunded on an account; a credit sale not in cash.
  begin
    perform public.record_sale_return(r2, sale_a,
      jsonb_build_array(jsonb_build_object('sale_item_id', line_a1, 'quantity', 1)),
      'wrong_item', null, 'credit');
    raise exception 'credit refund on a cash sale accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.record_sale_return(r2, sale_c,
      jsonb_build_array(jsonb_build_object('sale_item_id', line_c1, 'quantity', 1)),
      'wrong_item', null, 'cash');
    raise exception 'cash refund on a credit sale accepted';
  exception when invalid_parameter_value then null;
  end;
  -- A line of another sale; the same line twice.
  begin
    perform public.record_sale_return(r2, sale_a,
      jsonb_build_array(jsonb_build_object('sale_item_id', line_c1, 'quantity', 1)),
      'wrong_item', null, 'cash');
    raise exception 'a line of another sale accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.record_sale_return(r2, sale_a,
      jsonb_build_array(
        jsonb_build_object('sale_item_id', line_a1, 'quantity', 1),
        jsonb_build_object('sale_item_id', line_a1, 'quantity', 1)),
      'wrong_item', null, 'cash');
    raise exception 'the same line twice accepted';
  exception when invalid_parameter_value then null;
  end;
  -- Unknown sale.
  begin
    perform public.record_sale_return(r2, '30000000-0000-0000-0000-00000000dead',
      jsonb_build_array(jsonb_build_object('sale_item_id', line_a1, 'quantity', 1)),
      'wrong_item', null, 'cash');
    raise exception 'unknown sale accepted';
  exception when no_data_found then null;
  end;
  if (select stock_quantity from public.products where id = p1) <> stock_after then
    raise exception 'a refused return moved stock';
  end if;

  -- A voided sale cannot have returns.
  begin
    perform public.record_sale_return(r2, sale_b,
      jsonb_build_array(jsonb_build_object('sale_item_id', line_b1, 'quantity', 1)),
      'wrong_item', null, 'cash');
    raise exception 'returned items of a voided sale';
  exception when invalid_parameter_value then null;
  end;

  -------------------- the remainder: refunds of one line add up to what was paid
  -- 2nd return of 1: round(2657 * 2 / 3) - 886 = 1771 - 886 = 885.
  perform public.record_sale_return(r3, sale_a,
    jsonb_build_array(jsonb_build_object('sale_item_id', line_a1, 'quantity', 1)),
    'damaged', null, 'cash');
  select refund_cents into v from public.sale_returns where id = r3;
  if v <> 885 then raise exception 'second refund should be 885, got %', v; end if;
  -- Last unit takes the remainder: 2657 - 1771 = 886.
  perform public.record_sale_return(r4, sale_a,
    jsonb_build_array(jsonb_build_object('sale_item_id', line_a1, 'quantity', 1)),
    'damaged', null, 'cash');
  select refund_cents into v from public.sale_returns where id = r4;
  if v <> 886 then raise exception 'last refund should be 886, got %', v; end if;
  select sum(ri.refund_cents) into v from public.sale_return_items ri where ri.sale_item_id = line_a1;
  if v <> 2657 then raise exception 'the refunds of the line should add up to 2657, got %', v; end if;
  -- Nothing left to return on that line.
  begin
    perform public.record_sale_return(r5, sale_a,
      jsonb_build_array(jsonb_build_object('sale_item_id', line_a1, 'quantity', 0.001)),
      'wrong_item', null, 'cash');
    raise exception 'returned more than was sold, one gram at a time';
  exception when invalid_parameter_value then null;
  end;
  if (select stock_quantity from public.products where id = p1) <> stock_before + 3 then
    raise exception 'stock should be back to +3';
  end if;

  -- A line without a sale discount share: the whole 443 comes back (1 of 1).
  perform public.record_sale_return(r5, sale_a,
    jsonb_build_array(jsonb_build_object('sale_item_id', line_a2, 'quantity', 1)),
    'wrong_item', null, 'cash');
  select refund_cents into v from public.sale_returns where id = r5;
  if v <> 443 then raise exception 'refund of the P2 line should be 443, got %', v; end if;

  ------------------------------------------------ weighed product, decimals
  -- 1.250 kg paid 2500: 0.500 kg -> 1000, then 0.750 kg -> 1500 (the rest).
  perform public.record_sale_return(r6, sale_f,
    jsonb_build_array(jsonb_build_object('sale_item_id', line_f1, 'quantity', 0.5)),
    'wrong_item', null, 'cash');
  select refund_cents into v from public.sale_returns where id = r6;
  if v <> 1000 then raise exception '0.5 kg should refund 1000, got %', v; end if;
  begin
    perform public.record_sale_return(r7, sale_f,
      jsonb_build_array(jsonb_build_object('sale_item_id', line_f1, 'quantity', 0.8)),
      'wrong_item', null, 'cash');
    raise exception 'returned more kilos than remained';
  exception when invalid_parameter_value then null;
  end;
  perform public.record_sale_return(r7, sale_f,
    jsonb_build_array(jsonb_build_object('sale_item_id', line_f1, 'quantity', 0.75)),
    'wrong_item', null, 'cash');
  select refund_cents into v from public.sale_returns where id = r7;
  if v <> 1500 then raise exception '0.75 kg should refund 1500, got %', v; end if;
  if (select stock_quantity from public.products where id = p3) <> 10 then
    raise exception 'the weighed stock should be fully back (10), got %',
      (select stock_quantity from public.products where id = p3);
  end if;

  ------------------------------------------- a sale with returns cannot be voided
  begin
    perform public.void_sale(sale_a, 'oops');
    raise exception 'voided a sale that has returns';
  exception when others then
    if sqlerrm not like '%has returns%' then raise; end if;
  end;
  if (select voided_at from public.sales where id = sale_a) is not null then
    raise exception 'sale A was voided';
  end if;
  -- ... nor can a cashier ask for it.
  perform pg_temp.as_user(bb);
  begin
    perform public.request_void(sale_a, 'wrong_item');
    raise exception 'a void request was accepted for a sale that has returns';
  exception when others then
    if sqlerrm not like '%has returns%' then raise; end if;
  end;
  perform pg_temp.as_user(owner_id);

  ------------------------------------------------ credit sale: lowers the debt
  select balance_cents into v from public.customer_balances where id = client;
  if v <> 2000 then raise exception 'balance before the return should be 2000, got %', v; end if;
  perform public.record_sale_return(r8, sale_c,
    jsonb_build_array(jsonb_build_object('sale_item_id', line_c1, 'quantity', 1)),
    'wrong_item', null, 'credit');
  select balance_cents into v from public.customer_balances where id = client;
  if v <> 1000 then raise exception 'balance after returning 1 of 2 should be 1000, got %', v; end if;
  select credit_total_cents into v from public.customer_balances where id = client;
  if v <> 1000 then raise exception 'credit total should be net of the return (1000), got %', v; end if;
  select credit_available_cents into v from public.customer_balances where id = client;
  if v <> public.customer_credit_limit(client) - 1000 then
    raise exception 'credit available should follow the balance, got %', v;
  end if;

  --------------------------------------------- closed earlier day: still allowed
  -- Sale E belongs to a closed day; a void of it is refused, a return (paid
  -- today) is not.
  perform public.close_day('2020-03-10', 0, 0, 0);
  begin
    perform public.void_sale(sale_e, 'late void');
    raise exception 'voided a sale of a closed day';
  exception when others then
    if sqlerrm not like '%day is closed%' then raise; end if;
  end;
  perform public.record_sale_return('50000000-0000-0000-0000-000000000009', sale_e,
    jsonb_build_array(jsonb_build_object('sale_item_id', line_e1, 'quantity', 1)),
    'damaged', null, 'card');

  --------------------------------------------------------- reports (owner)
  select coalesce(sum(refund_cents), 0) into refunded_total from public.sale_returns;
  select coalesce(sum(round(ri.unit_cost_cents * ri.quantity)), 0)::bigint into returned_cost
  from public.sale_return_items ri;
  -- 2657 + 443 + 1000 + 1500 (cash) + 1000 (credit) + 500 (card, sale E from 2020)
  if refunded_total <> 7100 then raise exception 'refunds should total 7100, got %', refunded_total; end if;

  select revenue_cents, cogs_cents into rev_after, cogs_after
  from public.report_summary(now() - interval '1 day', now() + interval '1 day');
  -- Sale E is from 2020 but its refund is made today: it counts today.
  if rev_after <> rev_before - refunded_total then
    raise exception 'revenue should drop by %, % -> %', refunded_total, rev_before, rev_after;
  end if;
  if cogs_after <> cogs_before - returned_cost then
    raise exception 'cost of goods should drop by %, % -> %', returned_cost, cogs_before, cogs_after;
  end if;
  select returns_cents into v from public.report_summary(now() - interval '1 day', now() + interval '1 day');
  if v <> refunded_total then raise exception 'returns_cents should be %, got %', refunded_total, v; end if;
  -- The profit is revenue minus cost, so it drops by refund minus cost.
  select gross_profit_cents into v from public.report_summary(now() - interval '1 day', now() + interval '1 day');
  if v <> rev_after - cogs_after then raise exception 'profit is not revenue - cost'; end if;

  select coalesce(sum(quantity), 0) into qty_after
  from public.report_product_performance(now() - interval '1 day', now() + interval '1 day')
  where product_id = p1;
  if qty_after <> qty_before - 4 then
    raise exception 'P1 quantity sold should drop by 4 (3 + 1), % -> %', qty_before, qty_after;
  end if;

  -- Per day: the trend's revenue for today drops by the refunds.
  select coalesce(sum(revenue_cents), 0) into v
  from public.report_daily_trend(now() - interval '1 day', now() + interval '1 day');
  if v <> rev_after then raise exception 'the daily trend (%) does not add up to the summary (%)', v, rev_after; end if;
  select coalesce(sum(revenue_cents), 0) into v
  from public.report_by_hour(now() - interval '1 day', now() + interval '1 day');
  if v <> rev_after then raise exception 'the hourly report (%) does not add up to the summary (%)', v, rev_after; end if;
  select coalesce(sum(revenue_cents), 0) into v
  from public.report_by_category(now() - interval '1 day', now() + interval '1 day');
  if v <> rev_after then raise exception 'the category report (%) does not add up to the summary (%)', v, rev_after; end if;

  -- A cashier cannot read the economics views.
  perform pg_temp.as_user(bb);
  select count(*) into n from public.sale_return_economics;
  if n <> 0 then raise exception 'a cashier read the return economics'; end if;
  perform pg_temp.as_user(owner_id);

  ---------------------------------------------------------------- day close
  -- Today: cash refunds 2657 + 443 + 1000 + 1500 = 5600 (attributed to bb, who
  -- rang those sales up), card 500 (sale E), credit 1000.
  js := public.day_summary();
  select x into c from jsonb_array_elements(js -> 'cashiers') x where x ->> 'cashier_id' = bb::text;
  if (c ->> 'cash_refunds_cents')::bigint <> 5600
     or (c ->> 'card_refunds_cents')::bigint <> 500
     or (c ->> 'credit_refunds_cents')::bigint <> 1000
     or (c ->> 'refunds_count')::int <> 8 then
    raise exception 'wrong refund figures in the day summary: %', c;
  end if;

  -- A cashier sees the refunds of their own sales; another cashier none.
  perform pg_temp.as_user(bb);
  js := public.day_summary();
  if (js -> 'cashiers' -> 0 ->> 'cash_refunds_cents')::bigint <> 5600 then
    raise exception 'cashier bb should see the refunds of their own sales: %', js;
  end if;
  perform pg_temp.as_user(cc);
  js := public.day_summary();
  if jsonb_array_length(js -> 'cashiers') <> 0 then
    raise exception 'cashier cc saw rows: %', js;
  end if;
  perform pg_temp.as_user(owner_id);

  -- Expected cash = float + cash sales + cash payments - cash refunds.
  select coalesce(sum(total_cents), 0) into sum_expected
  from public.sales
  where voided_at is null and payment_method = 'cash'
    and public.store_day(occurred_at) = public.store_day(now());
  sum_expected := 100 + sum_expected
    + (select coalesce(sum(amount_cents), 0) from public.customer_payments
       where method = 'cash' and public.store_day(created_at) = public.store_day(now()))
    - 5600;
  closed := public.close_day(public.store_day(now()), 100, 0, 0);
  if closed.expected_cash_cents <> sum_expected then
    raise exception 'expected cash should be %, got %', sum_expected, closed.expected_cash_cents;
  end if;
  if closed.cash_refunds_cents <> 5600 or closed.card_refunds_cents <> 500
     or closed.credit_refunds_cents <> 1000 then
    raise exception 'the day close should snapshot the refunds: % / % / %',
      closed.cash_refunds_cents, closed.card_refunds_cents, closed.credit_refunds_cents;
  end if;

  -- Today is closed: no refund can be paid out any more...
  begin
    perform public.record_sale_return('50000000-0000-0000-0000-00000000000a', sale_g,
      jsonb_build_array(jsonb_build_object('sale_item_id', line_g1, 'quantity', 1)),
      'wrong_item', null, 'cash');
    raise exception 'a refund was recorded on a closed day';
  exception when others then
    if sqlerrm not like '%day is closed%' then raise; end if;
  end;
  -- ... but replaying one that was already recorded is still harmless.
  perform public.record_sale_return(r1, sale_a,
    jsonb_build_array(jsonb_build_object('sale_item_id', line_a1, 'quantity', 1)),
    'customer_changed_mind', 'brought it back', 'cash');

  ------------------------------------------------------------------ RLS reads
  set local role authenticated;

  -- bb sees the returns of their own sales, and the cost-free item view.
  perform pg_temp.as_user(bb);
  select count(*) into n from public.sale_returns;
  if n <> 8 then reset role; raise exception 'cashier bb should see 8 returns, saw %', n; end if;
  select count(*) into n from public.sale_return_items_cashier_view;
  if n <> 8 then reset role; raise exception 'cashier bb should see 8 return lines, saw %', n; end if;
  -- ... never the items table (it holds the cost) ...
  select count(*) into n from public.sale_return_items;
  if n <> 0 then reset role; raise exception 'cashier bb read the return items table: %', n; end if;
  -- ... and the view has no cost column.
  begin
    execute 'select unit_cost_cents from public.sale_return_items_cashier_view';
    reset role;
    raise exception 'the cashier view exposes the cost';
  exception when undefined_column then null;
  end;

  -- cc sees none of bb's.
  perform pg_temp.as_user(cc);
  select count(*) into n from public.sale_returns;
  if n <> 0 then reset role; raise exception 'cashier cc saw % returns', n; end if;
  select count(*) into n from public.sale_return_items_cashier_view;
  if n <> 0 then reset role; raise exception 'cashier cc saw % return lines', n; end if;

  -- Nobody writes directly.
  perform pg_temp.as_user(owner_id);
  begin
    insert into public.sale_returns (sale_id, reason_code, refund_method, refund_cents)
    values (sale_g, 'wrong_item', 'cash', 1);
    reset role;
    raise exception 'owner inserted a return directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.sale_returns set refund_cents = 0;
    reset role;
    raise exception 'owner updated a return directly';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.sale_return_items;
  if n <> 8 then reset role; raise exception 'owner should read the 8 return lines, saw %', n; end if;

  reset role;
end $$;


-- ---------------------------------------------------------------------------
-- Second part (the day closed above is reopened for it; everything is still
-- rolled back): the debt-limit review after a credit return, and the
-- customer's credit returns for the Clients timeline.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
delete from public.day_closes;

insert into public.products (id, name, selling_price_cents, current_cost_cents, stock_quantity)
values ('20000000-0000-0000-0000-000000000014', 'Return limit item', 1000, 600, 1000);
-- Limit L = 5000. Two customers, so both halves of the check start from "owes
-- exactly L after a return" fresh.
insert into public.customers (id, name, credit_limit_cents)
values ('00000000-0000-0000-0000-0000000000e1', 'Limit client R', 5000),
       ('00000000-0000-0000-0000-0000000000e2', 'Limit client R+1', 5000);
-- Each owes exactly L: one credit sale of 5 x 1000, rung up by the owner.
insert into public.sales (id, cashier_id, customer_id, payment_method, discount_cents, total_cents, occurred_at)
values
  ('30000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000e1', 'credit', 0, 5000, now()),
  ('30000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000e2', 'credit', 0, 5000, now());
insert into public.sale_items (id, sale_id, product_id, quantity, unit_price_cents, line_total_cents)
values
  ('40000000-0000-0000-0000-0000000000e2', '30000000-0000-0000-0000-0000000000b2', '20000000-0000-0000-0000-000000000014', 5, 1000, 5000),
  ('40000000-0000-0000-0000-0000000000e3', '30000000-0000-0000-0000-0000000000b3', '20000000-0000-0000-0000-000000000014', 5, 1000, 5000);

do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  bb uuid := '00000000-0000-0000-0000-0000000000bb';
  cc uuid := '00000000-0000-0000-0000-0000000000cc';
  prod uuid := '20000000-0000-0000-0000-000000000014';
  c1 uuid := '00000000-0000-0000-0000-0000000000e1';
  c2 uuid := '00000000-0000-0000-0000-0000000000e2';
  client uuid := '00000000-0000-0000-0000-0000000000d9';
  sale_c uuid := '30000000-0000-0000-0000-0000000000c1';
  sale_z uuid := '30000000-0000-0000-0000-0000000000b2';
  n int;
  v bigint;
  r record;
  new_sale uuid;
begin
  ------------------------------------------- debt limit after a credit return
  perform pg_temp.as_user(owner_id);
  -- Both owe exactly L (5000); each hands one unit (R = 1000) back on account.
  perform public.record_sale_return('50000000-0000-0000-0000-0000000000e1', sale_z,
    jsonb_build_array(jsonb_build_object('sale_item_id', '40000000-0000-0000-0000-0000000000e2', 'quantity', 1)),
    'wrong_item', null, 'credit');
  perform public.record_sale_return('50000000-0000-0000-0000-0000000000e2', '30000000-0000-0000-0000-0000000000b3',
    jsonb_build_array(jsonb_build_object('sale_item_id', '40000000-0000-0000-0000-0000000000e3', 'quantity', 1)),
    'wrong_item', null, 'credit');
  select balance_cents into v from public.customer_balances where id = c1;
  if v <> 4000 then raise exception 'balance after the return should be 4000, got %', v; end if;

  -- A cashier credit sale of R (1000) takes the customer back to exactly L: fine.
  perform pg_temp.as_user(bb);
  new_sale := '30000000-0000-0000-0000-0000000000f2';
  perform public.record_sale(new_sale, c1, 'credit', 0,
    jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 1, 'unit_price_cents', 1000)), now());
  if (select needs_credit_review from public.sales where id = new_sale) then
    raise exception 'a credit sale of R after a return of R was flagged over the limit';
  end if;

  -- R + 1 goes over L and is flagged.
  new_sale := '30000000-0000-0000-0000-0000000000f3';
  perform public.record_sale(new_sale, c2, 'credit', 0,
    jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 1, 'unit_price_cents', 1001)), now());
  if not (select needs_credit_review from public.sales where id = new_sale) then
    raise exception 'a credit sale of R+1 over the limit was not flagged';
  end if;

  ----------------------------------------------- the customer's credit returns
  -- Sale C (client d9, credit) had 1 of 2 units returned on account earlier.
  -- A cashier who did not ring it up can read it.
  perform pg_temp.as_user(cc);
  select count(*) into n from public.customer_credit_returns(client);
  if n <> 1 then raise exception 'cashier cc should see 1 credit return, saw %', n; end if;
  select * into r from public.customer_credit_returns(client);
  if r.refund_cents <> 1000 or r.sale_id <> sale_c or r.item_count <> 1 or r.occurred_at is null then
    raise exception 'wrong credit return row: %', r;
  end if;
  -- The shape has no cost, line or reason column.
  if exists (
    select 1 from information_schema.parameters
    where specific_schema = 'public' and parameter_mode = 'OUT'
      and specific_name like 'customer_credit_returns%'
      and parameter_name in ('unit_cost_cents', 'reason_code', 'note', 'cost_cents')
  ) then raise exception 'the credit returns function exposes more than it should'; end if;
  -- Another customer sees nothing of it.
  select count(*) into n from public.customer_credit_returns(c2) where sale_id = sale_c;
  if n <> 0 then raise exception 'credit returns leaked across customers'; end if;
  -- No session: refused.
  perform set_config('request.jwt.claims', '', true);
  begin
    perform * from public.customer_credit_returns(client);
    raise exception 'an anonymous caller read credit returns';
  exception when insufficient_privilege then null;
  end;
  begin
    perform pg_temp.as_user(cc);
    perform * from public.customer_credit_returns(client, 10, -1);
    raise exception 'a negative offset was accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Only credit returns: add a cash-method return row to sale C and 104 more
  -- credit ones (as the database owner), to check the filter and the page cap.
  perform set_config('request.jwt.claims', '', true);
  insert into public.sale_returns (id, sale_id, created_by, created_at, reason_code, refund_method, refund_cents)
  values (gen_random_uuid(), sale_c, owner_id, now() + interval '1 hour', 'other', 'cash', 123);
  insert into public.sale_returns (id, sale_id, created_by, created_at, reason_code, refund_method, refund_cents)
  select gen_random_uuid(), sale_c, owner_id, now() - (g || ' minutes')::interval, 'other', 'credit', 0
  from generate_series(1, 104) g;
  perform pg_temp.as_user(cc);
  if exists (select 1 from public.customer_credit_returns(client, 100) where refund_cents = 123) then
    raise exception 'a cash refund was listed as a credit return';
  end if;
  select count(*) into n from public.customer_credit_returns(client, 1000);
  if n <> 100 then raise exception 'the page size should be capped at 100, got %', n; end if;
  select count(*) into n from public.customer_credit_returns(client, 100, 100);
  if n <> 5 then raise exception 'the next page should hold the other 5 of 105, got %', n; end if;
  select count(*) into n from public.customer_credit_returns(client, 0);
  if n <> 1 then raise exception 'a limit below 1 should give 1 row, got %', n; end if;
  -- Newest first.
  select refund_cents into v from public.customer_credit_returns(client, 1, 0);
  if v <> 1000 then raise exception 'the newest credit return should come first, got %', v; end if;
end $$;

rollback;
