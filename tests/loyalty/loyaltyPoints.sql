-- Loyalty points (migration 048). Runs in CI after `supabase db reset`, as
-- postgres. Every write is rolled back. The seed has an owner 'aa' and a
-- cashier 'bb'.
begin;

delete from public.day_closes;

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
create function pg_temp.eqt(p_label text, p_got text, p_want text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception '%: got %, wanted %', p_label, p_got, p_want;
  end if;
end;
$$;
create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'failed: %', p_label; end if;
end;
$$;
create function pg_temp.sid(p_n int) returns uuid language sql as $$
  select ('5a000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
$$;
create function pg_temp.ln(p_product uuid, p_qty numeric, p_price bigint) returns jsonb language sql as $$
  select jsonb_build_object('product_id', p_product, 'quantity', p_qty, 'unit_price_cents', p_price);
$$;
create function pg_temp.sell(p_id uuid, p_user uuid, p_cust uuid, p_method text, p_disc bigint,
                             p_lines jsonb, p_loy jsonb default null)
returns void language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  perform public.record_sale(p_id, p_cust, p_method::public.payment_method, p_disc, p_lines, now(), null, p_loy);
end;
$$;
create function pg_temp.led(p_sale uuid, p_kind text) returns bigint language sql as $$
  select coalesce(sum(points), 0)::bigint from public.loyalty_ledger where sale_id = p_sale and kind = p_kind;
$$;
create function pg_temp.bal(p_customer uuid) returns bigint language sql as $$
  select coalesce(sum(points), 0)::bigint from public.loyalty_ledger where customer_id = p_customer;
$$;
create function pg_temp.reason(p_sale uuid) returns text language sql as $$
  select details ->> 'reason' from public.activity_log
  where entity_id = p_sale and action = 'loyalty_redeem_unconfirmed';
$$;

-- Products. P1 and P2 normal; PX excluded itself; PC in an excluded category;
-- PS in a sub-category of that excluded category (the sub-category is not
-- excluded itself: the parent's exclusion covers it).
insert into public.categories (id, name, loyalty_excluded)
values ('5b000000-0000-0000-0000-000000000001', 'Loyalty test excluded cat', true);
insert into public.categories (id, name, parent_id)
values ('5b000000-0000-0000-0000-000000000002', 'Loyalty test sub of excluded',
        '5b000000-0000-0000-0000-000000000001');
insert into public.products (id, name, selling_price_cents, current_cost_cents, stock_quantity)
values
  ('5c000000-0000-0000-0000-000000000001', 'Loy P1', 1000, 600, 1000),
  ('5c000000-0000-0000-0000-000000000002', 'Loy P2', 700, 400, 1000);
insert into public.products (id, name, selling_price_cents, current_cost_cents, stock_quantity, loyalty_excluded)
values ('5c000000-0000-0000-0000-000000000003', 'Loy PX excluded', 1000, 600, 1000, true);
insert into public.products (id, name, selling_price_cents, current_cost_cents, stock_quantity, category_id)
values
  ('5c000000-0000-0000-0000-000000000004', 'Loy PC in excluded cat', 1000, 600, 1000, '5b000000-0000-0000-0000-000000000001'),
  ('5c000000-0000-0000-0000-000000000005', 'Loy PS in sub-category', 1000, 600, 1000, '5b000000-0000-0000-0000-000000000002');

-- Bonus products: PB +20 per unit, PBE a bonus that ended yesterday, PBX a bonus on
-- an excluded product, PK a kg product with +5 per whole kg.
insert into public.products (id, name, selling_price_cents, current_cost_cents, stock_quantity, loyalty_bonus_points)
values ('5c000000-0000-0000-0000-000000000006', 'Loy PB bonus', 1000, 600, 1000, 20);
insert into public.products (id, name, selling_price_cents, current_cost_cents, stock_quantity, loyalty_bonus_points, loyalty_bonus_until)
values ('5c000000-0000-0000-0000-000000000007', 'Loy PBE ended', 1000, 600, 1000, 20, now() - interval '1 day');
insert into public.products (id, name, selling_price_cents, current_cost_cents, stock_quantity, loyalty_bonus_points, loyalty_excluded)
values ('5c000000-0000-0000-0000-000000000008', 'Loy PBX excluded bonus', 1000, 600, 1000, 20, true);
insert into public.products (id, name, unit, selling_price_cents, current_cost_cents, stock_quantity, loyalty_bonus_points)
values ('5c000000-0000-0000-0000-000000000009', 'Loy PK kg', 'kg', 2000, 1200, 1000, 5);

-- Start from a known configuration (rolled back at the end).
update public.store_settings
set loyalty_enabled = true, loyalty_cents_per_point = 1000, loyalty_point_value_cents = 10,
    loyalty_min_redeem_points = 100, loyalty_daily_review_points = 100, loyalty_welcome_points = 0;

---------------------------------------------------------------- phone normalisation
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('0612345678', '+212612345678'),
      ('06 12 34 56 78', '+212612345678'),
      ('06.12.34.56.78', '+212612345678'),
      ('06-12-34-56-78', '+212612345678'),
      ('0712345678', '+212712345678'),
      ('0522345678', '+212522345678'),
      ('+212612345678', '+212612345678'),
      ('+212 6 12 34 56 78', '+212612345678'),
      ('00212612345678', '+212612345678'),
      ('212612345678', '+212612345678'),
      ('612345678', '+212612345678'),
      ('0812345678', null),
      ('061234567', null),
      ('06123456789', null),
      ('+33612345678', null),
      ('abc', null),
      ('', null),
      (null, null)
    ) as t(input, expected)
  loop
    if public.normalize_ma_phone(r.input) is distinct from r.expected then
      raise exception 'normalize_ma_phone(%) = %, wanted %', r.input, public.normalize_ma_phone(r.input), r.expected;
    end if;
  end loop;
end $$;

---------------------------------------------------------------- constraints
do $$
begin
  begin
    insert into public.customers (name, phone_e164) values ('Bad phone', '+2128123');
    raise exception 'bad phone_e164 accepted';
  exception when check_violation then null;
  end;
  begin
    update public.store_settings set loyalty_cents_per_point = 0;
    raise exception 'zero rate accepted';
  exception when check_violation then null;
  end;
  begin
    update public.store_settings set loyalty_welcome_points = -1;
    raise exception 'negative welcome accepted';
  exception when check_violation then null;
  end;
end $$;

---------------------------------------------------------------- join / lookup / card
do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id uuid := '00000000-0000-0000-0000-0000000000bb';
  j record;
  j2 record;
  legacy uuid := '5d000000-0000-0000-0000-000000000001';
  nomember uuid := '5d000000-0000-0000-0000-000000000002';
  l record;
  n int;
begin
  perform pg_temp.as_user(cashier_id);

  -- consent is required, the phone must be Moroccan
  begin
    perform * from public.loyalty_join('0612345678', 'Fatima Zahra', false);
    raise exception 'joined without consent';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform * from public.loyalty_join('0812345678', 'Nope', true);
    raise exception 'joined with a bad phone';
  exception when sqlstate '22023' then null;
  end;

  -- new member
  select * into j from public.loyalty_join('06 12 34 56 78', ' Fatima Zahra ', true);
  perform pg_temp.ok('created', j.created);
  perform pg_temp.eqt('name', j.name, 'Fatima Zahra');
  perform pg_temp.eq('token length', char_length(j.card_token), 22);
  perform pg_temp.ok('token is base64url', j.card_token ~ '^[A-Za-z0-9_-]{22}$');
  perform pg_temp.eq('balance', j.balance, 0);
  perform pg_temp.ok('consent stored', (select loyalty_consent_at is not null and loyalty_joined_at is not null
    from public.customers where id = j.customer_id) is not distinct from true) ;

  -- same number in another format: the same member, same token, nothing created
  select * into j2 from public.loyalty_join('+212612345678', 'Someone else', true);
  perform pg_temp.ok('same customer', j2.customer_id = j.customer_id);
  perform pg_temp.ok('not created again', not j2.created);
  perform pg_temp.eqt('token kept', j2.card_token, j.card_token);
  perform pg_temp.eqt('name kept', j2.name, 'Fatima Zahra');

  -- legacy customer with a free-text phone is linked, not duplicated
  insert into public.customers (id, name, phone) values (legacy, 'Legacy Client', '06 98 76 54 32');
  select * into j2 from public.loyalty_join('0698765432', 'Ignored name', true);
  perform pg_temp.ok('legacy linked', j2.customer_id = legacy);
  perform pg_temp.ok('legacy not created', not j2.created);
  perform pg_temp.eqt('legacy name kept', j2.name, 'Legacy Client');
  perform pg_temp.eqt('legacy e164', (select phone_e164 from public.customers where id = legacy), '+212698765432');
  select count(*) into n from public.customers where phone_e164 = '+212698765432';
  perform pg_temp.eq('one customer for the number', n, 1);

  -- an existing customer row holding the e164 but not a member yet
  insert into public.customers (id, name, phone_e164) values (nomember, 'Existing Name', '+212655443322');
  select * into j2 from public.loyalty_lookup('0655443322');
  perform pg_temp.ok('lookup finds non-member', j2.customer_id = nomember and not j2.is_member);
  select * into j2 from public.loyalty_join('0655443322', 'Other', true);
  perform pg_temp.ok('existing becomes member', j2.customer_id = nomember and not j2.created);
  perform pg_temp.eqt('existing name kept', j2.name, 'Existing Name');

  -- name defaults to the phone
  select * into j2 from public.loyalty_join('0711223344', '  ', true);
  perform pg_temp.eqt('default name', j2.name, '+212711223344');

  -- welcome points, once
  update public.store_settings set loyalty_welcome_points = 50;
  select * into j2 from public.loyalty_join('0722334455', 'Welcome Test', true);
  perform pg_temp.eq('welcome balance', j2.balance, 50);
  perform pg_temp.eqt('welcome note', (select note from public.loyalty_ledger where customer_id = j2.customer_id), 'welcome');
  perform * from public.loyalty_join('0722334455', 'Welcome Test', true);
  perform pg_temp.eq('welcome only once', pg_temp.bal(j2.customer_id), 50);
  update public.store_settings set loyalty_welcome_points = 0;

  -- lookup
  select * into l from public.loyalty_lookup('0612345678');
  perform pg_temp.ok('lookup member', l.customer_id = j.customer_id and l.is_member and l.balance = 0);
  select count(*) into n from public.loyalty_lookup('0600000000');
  perform pg_temp.eq('lookup unknown', n, 0);
  select count(*) into n from public.loyalty_lookup('12');
  perform pg_temp.eq('lookup invalid', n, 0);

  -- card QR
  select * into l from public.loyalty_card_customer(j.card_token);
  perform pg_temp.ok('card customer', l.customer_id = j.customer_id and l.name = 'Fatima Zahra');
  select count(*) into n from public.loyalty_card_customer('nope');
  perform pg_temp.eq('card unknown', n, 0);
  select count(*) into n from public.loyalty_card_customer(null);
  perform pg_temp.eq('card null', n, 0);

  -- check_redeem: every reason
  perform pg_temp.as_user(owner_id);
  perform public.loyalty_adjust(j.customer_id, 150, 'test credit');
  perform pg_temp.as_user(cashier_id);
  perform pg_temp.ok('check ok', (public.loyalty_check_redeem(j.customer_id, 100, j.card_token) ->> 'ok')::boolean);
  perform pg_temp.eq('check value', (public.loyalty_check_redeem(j.customer_id, 100, j.card_token) ->> 'value_cents')::bigint, 1000);
  perform pg_temp.eq('check balance', (public.loyalty_check_redeem(j.customer_id, 100, j.card_token) ->> 'balance')::bigint, 150);
  perform pg_temp.eqt('no proof', public.loyalty_check_redeem(j.customer_id, 100, null) ->> 'reason', 'no_proof');
  perform pg_temp.eqt('wrong proof', public.loyalty_check_redeem(j.customer_id, 100, 'x') ->> 'reason', 'no_proof');
  perform pg_temp.eqt('below min', public.loyalty_check_redeem(j.customer_id, 99, j.card_token) ->> 'reason', 'below_minimum');
  perform pg_temp.eqt('over balance', public.loyalty_check_redeem(j.customer_id, 151, j.card_token) ->> 'reason', 'over_balance');
  perform pg_temp.eqt('not member', public.loyalty_check_redeem(gen_random_uuid(), 100, j.card_token) ->> 'reason', 'not_member');
  update public.store_settings set loyalty_enabled = false;
  perform pg_temp.eqt('disabled', public.loyalty_check_redeem(j.customer_id, 100, j.card_token) ->> 'reason', 'disabled');
  update public.store_settings set loyalty_enabled = true;

  -- back to zero so the later numbers are simple
  perform pg_temp.as_user(owner_id);
  perform public.loyalty_adjust(j.customer_id, -150, 'test credit back');
  perform pg_temp.eq('balance back to zero', pg_temp.bal(j.customer_id), 0);
end $$;

---------------------------------------------------------------- earning
do $$
declare
  cashier_id uuid := '00000000-0000-0000-0000-0000000000bb';
  fatima uuid := (select id from public.customers where phone_e164 = '+212612345678');
  p1 uuid := '5c000000-0000-0000-0000-000000000001';
  px uuid := '5c000000-0000-0000-0000-000000000003';
  pc uuid := '5c000000-0000-0000-0000-000000000004';
  ps uuid := '5c000000-0000-0000-0000-000000000005';
  divers uuid := (select id from public.products where kind = 'misc');
  s public.sales%rowtype;
  n int;
begin
  update public.store_settings set loyalty_cents_per_point = 500;

  -- Offline-style: only the phone. P1 x2 (2000, earns), excluded product,
  -- product in the excluded category, product in its sub-category, Divers
  -- (1000 each), sale discount 300 (5% of 6000 = 300, so no cashier review).
  perform pg_temp.sell(pg_temp.sid(1), cashier_id, null, 'cash', 300,
    jsonb_build_array(
      pg_temp.ln(p1, 2, 1000), pg_temp.ln(px, 1, 1000), pg_temp.ln(pc, 1, 1000),
      pg_temp.ln(ps, 1, 1000), pg_temp.ln(divers, 1, 1000)),
    jsonb_build_object('phone', '06 12 34 56 78'));
  select * into s from public.sales where id = pg_temp.sid(1);
  perform pg_temp.ok('member set as customer', s.customer_id = fatima);
  -- discount share: 300 * 2000 / 6000 = 100 off P1 -> paid 1900; 1900 / 500 = 3.8 -> 3
  perform pg_temp.eq('earned (floor, only eligible lines)', pg_temp.led(pg_temp.sid(1), 'earn'), 3);
  perform pg_temp.eq('rate stamped', s.loyalty_cents_per_point, 500);
  perform pg_temp.ok('not flagged', not s.needs_loyalty_review and not s.needs_discount_review);
  select count(*) into n from public.sale_items where sale_id = pg_temp.sid(1) and loyalty_eligible;
  perform pg_temp.eq('only P1 is eligible', n, 1);

  -- replay of the same sale id: nothing more is written
  perform pg_temp.sell(pg_temp.sid(1), cashier_id, null, 'cash', 300,
    jsonb_build_array(pg_temp.ln(p1, 2, 1000), pg_temp.ln(px, 1, 1000), pg_temp.ln(pc, 1, 1000),
      pg_temp.ln(ps, 1, 1000), pg_temp.ln(divers, 1, 1000)),
    jsonb_build_object('phone', '0612345678'));
  select count(*) into n from public.loyalty_ledger where sale_id = pg_temp.sid(1);
  perform pg_temp.eq('replay writes nothing', n, 1);
  perform pg_temp.eq('balance after replay', pg_temp.bal(fatima), 3);

  -- the unique index also refuses a second earn row by hand
  begin
    insert into public.loyalty_ledger (customer_id, sale_id, kind, points)
    values (fatima, pg_temp.sid(1), 'earn', 1);
    raise exception 'second earn row accepted';
  exception when unique_violation then null;
  end;

  -- customer id path; a member sale with only excluded items earns nothing
  perform pg_temp.sell(pg_temp.sid(2), cashier_id, fatima, 'cash', 0,
    jsonb_build_array(pg_temp.ln(px, 3, 1000)),
    jsonb_build_object('customer_id', fatima));
  select count(*) into n from public.loyalty_ledger where sale_id = pg_temp.sid(2);
  perform pg_temp.eq('excluded only: no ledger row', n, 0);

  -- disabled: nothing earned
  update public.store_settings set loyalty_enabled = false;
  perform pg_temp.sell(pg_temp.sid(3), cashier_id, null, 'cash', 0,
    jsonb_build_array(pg_temp.ln(p1, 4, 1000)), jsonb_build_object('phone', '0612345678'));
  perform pg_temp.eq('disabled earns nothing', pg_temp.led(pg_temp.sid(3), 'earn'), 0);
  update public.store_settings set loyalty_enabled = true;

  -- unknown phone: the sale goes through, nothing happens
  perform pg_temp.sell(pg_temp.sid(4), cashier_id, null, 'cash', 0,
    jsonb_build_array(pg_temp.ln(p1, 4, 1000)), jsonb_build_object('phone', '0600000000'));
  perform pg_temp.ok('sale recorded, no flag',
    exists (select 1 from public.sales where id = pg_temp.sid(4) and customer_id is null and not needs_loyalty_review));

  -- a sale for another customer: they stay on the sale, nothing awarded, flagged
  perform pg_temp.sell(pg_temp.sid(5), cashier_id, '5d000000-0000-0000-0000-000000000001', 'cash', 0,
    jsonb_build_array(pg_temp.ln(p1, 4, 1000)), jsonb_build_object('phone', '0612345678'));
  select * into s from public.sales where id = pg_temp.sid(5);
  perform pg_temp.ok('customer kept', s.customer_id = '5d000000-0000-0000-0000-000000000001');
  perform pg_temp.ok('flagged', s.needs_loyalty_review);
  perform pg_temp.eq('nothing awarded', pg_temp.led(pg_temp.sid(5), 'earn'), 0);

  -- a credit sale to the member earns too
  perform pg_temp.sell(pg_temp.sid(6), cashier_id, fatima, 'credit', 0,
    jsonb_build_array(pg_temp.ln(p1, 1, 1000)), jsonb_build_object('phone', '0612345678'));
  perform pg_temp.eq('credit sale earns', pg_temp.led(pg_temp.sid(6), 'earn'), 2);

  perform pg_temp.eq('balance', pg_temp.bal(fatima), 5);
  update public.store_settings set loyalty_cents_per_point = 1000;
end $$;

---------------------------------------------------------------- redemption
do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id uuid := '00000000-0000-0000-0000-0000000000bb';
  fatima uuid := (select id from public.customers where phone_e164 = '+212612345678');
  token text := (select card_token from public.customers where phone_e164 = '+212612345678');
  p1 uuid := '5c000000-0000-0000-0000-000000000001';
  divers uuid := (select id from public.products where kind = 'misc');
  px_excluded uuid := '5c000000-0000-0000-0000-000000000003';
  karim uuid;
  before_bal bigint;
  s public.sales%rowtype;
begin
  perform pg_temp.as_user(owner_id);
  perform public.loyalty_adjust(fatima, 500, 'top up for the redemption tests');
  before_bal := pg_temp.bal(fatima);
  perform pg_temp.eq('balance 505', before_bal, 505);

  -- ok path: 200 points = 2000 centimes off a 5000 basket. As a plain cashier
  -- discount that would break the limit (5% of 5000 = 250): it must not.
  perform pg_temp.sell(pg_temp.sid(10), cashier_id, null, 'cash', 2000,
    jsonb_build_array(pg_temp.ln(p1, 5, 1000)),
    jsonb_build_object('customer_id', fatima, 'redeem_points', 200, 'card_token', token));
  select * into s from public.sales where id = pg_temp.sid(10);
  perform pg_temp.eq('redeemed on the sale', s.loyalty_points_redeemed, 200);
  perform pg_temp.eq('points discount on the sale', s.loyalty_discount_cents, 2000);
  perform pg_temp.eq('total', s.total_cents, 3000);
  perform pg_temp.ok('no review flags', not s.needs_loyalty_review and not s.needs_discount_review);
  perform pg_temp.eq('ledger redeem', pg_temp.led(pg_temp.sid(10), 'redeem'), -200);
  perform pg_temp.eq('earns on what was paid in money', pg_temp.led(pg_temp.sid(10), 'earn'), 3);
  perform pg_temp.eq('balance', pg_temp.bal(fatima), before_bal - 200 + 3);
  perform pg_temp.ok('no review activity row', not exists (
    select 1 from public.activity_log where entity_id = pg_temp.sid(10)
      and action in ('loyalty_redeem_unconfirmed', 'discount_over_cashier_limit', 'discount_over_threshold')));

  -- the same discount WITHOUT points is still a cashier discount breach
  perform pg_temp.sell(pg_temp.sid(11), cashier_id, null, 'cash', 2000,
    jsonb_build_array(pg_temp.ln(p1, 5, 1000)));
  perform pg_temp.ok('plain discount flagged', (select needs_discount_review from public.sales where id = pg_temp.sid(11)));

  -- points plus a cashier discount over the limit: only the cashier part counts
  perform pg_temp.sell(pg_temp.sid(12), cashier_id, null, 'cash', 2600,
    jsonb_build_array(pg_temp.ln(p1, 5, 1000)),
    jsonb_build_object('customer_id', fatima, 'redeem_points', 200, 'card_token', token));
  perform pg_temp.ok('600 cashier part over the 250 limit', (select needs_discount_review from public.sales where id = pg_temp.sid(12)));
  perform pg_temp.ok('points part confirmed', not (select needs_loyalty_review from public.sales where id = pg_temp.sid(12)));

  -- failures: each one records the sale as rung up, flags it, logs the reason
  perform pg_temp.as_user(owner_id);
  perform public.loyalty_adjust(fatima, 1000, 'plenty of points for the failure cases');
  perform pg_temp.sell(pg_temp.sid(20), cashier_id, null, 'cash', 1000,
    jsonb_build_array(pg_temp.ln(p1, 5, 1000)),
    jsonb_build_object('customer_id', fatima, 'redeem_points', 100, 'card_token', 'wrong'));
  perform pg_temp.ok('wrong token flagged', (select needs_loyalty_review from public.sales where id = pg_temp.sid(20)));
  perform pg_temp.eqt('wrong token reason', pg_temp.reason(pg_temp.sid(20)), 'no_proof');
  perform pg_temp.eq('wrong token still charged as claimed', pg_temp.led(pg_temp.sid(20), 'redeem'), -100);
  perform pg_temp.eq('sale total kept', (select total_cents from public.sales where id = pg_temp.sid(20)), 4000);

  perform pg_temp.sell(pg_temp.sid(21), cashier_id, null, 'cash', 1000,
    jsonb_build_array(pg_temp.ln(p1, 5, 1000)),
    jsonb_build_object('customer_id', fatima, 'redeem_points', 100));
  perform pg_temp.eqt('no token reason', pg_temp.reason(pg_temp.sid(21)), 'no_proof');

  perform pg_temp.sell(pg_temp.sid(22), cashier_id, null, 'cash', 500,
    jsonb_build_array(pg_temp.ln(p1, 5, 1000)),
    jsonb_build_object('customer_id', fatima, 'redeem_points', 50, 'card_token', token));
  perform pg_temp.eqt('below minimum reason', pg_temp.reason(pg_temp.sid(22)), 'below_minimum');
  perform pg_temp.ok('below minimum flagged', (select needs_loyalty_review from public.sales where id = pg_temp.sid(22)));

  -- over balance: a member with 50 points claims 100
  perform pg_temp.as_user(cashier_id);
  select customer_id into karim from public.loyalty_join('0633445566', 'Karim', true);
  perform pg_temp.as_user(owner_id);
  perform public.loyalty_adjust(karim, 50, 'few points');
  perform pg_temp.sell(pg_temp.sid(23), cashier_id, null, 'cash', 1000,
    jsonb_build_array(pg_temp.ln(p1, 5, 1000)),
    jsonb_build_object('customer_id', karim, 'redeem_points', 100,
      'card_token', (select card_token from public.customers where id = karim)));
  perform pg_temp.eqt('over balance reason', pg_temp.reason(pg_temp.sid(23)), 'over_balance');
  perform pg_temp.eq('over balance recorded as claimed', pg_temp.led(pg_temp.sid(23), 'redeem'), -100);
  perform pg_temp.eq('karim balance 50 - 100 + 4', pg_temp.bal(karim), -46);

  -- value above the eligible amount: Divers cannot be paid with points
  perform pg_temp.sell(pg_temp.sid(24), cashier_id, null, 'cash', 1500,
    jsonb_build_array(pg_temp.ln(divers, 1, 3000), pg_temp.ln(p1, 1, 1000)),
    jsonb_build_object('customer_id', fatima, 'redeem_points', 150, 'card_token', token));
  perform pg_temp.eqt('over eligible reason', pg_temp.reason(pg_temp.sid(24)), 'over_eligible');
  perform pg_temp.ok('over eligible flagged', (select needs_loyalty_review from public.sales where id = pg_temp.sid(24)));

  -- an excluded product cannot be paid with points either: 30.00 DH excluded +
  -- 10.00 DH eligible, 15.00 DH of points claimed
  perform pg_temp.sell(pg_temp.sid(74), cashier_id, null, 'cash', 1500,
    jsonb_build_array(pg_temp.ln(px_excluded, 1, 3000), pg_temp.ln(p1, 1, 1000)),
    jsonb_build_object('customer_id', fatima, 'redeem_points', 150, 'card_token', token));
  perform pg_temp.eqt('excluded items are not payable with points',
    pg_temp.reason(pg_temp.sid(74)), 'over_eligible');
  -- 10.00 DH of points on the same basket is fine
  perform pg_temp.sell(pg_temp.sid(75), cashier_id, null, 'cash', 1000,
    jsonb_build_array(pg_temp.ln(px_excluded, 1, 3000), pg_temp.ln(p1, 1, 1000)),
    jsonb_build_object('customer_id', fatima, 'redeem_points', 100, 'card_token', token));
  perform pg_temp.ok('points up to the eligible amount are not flagged',
    not (select needs_loyalty_review from public.sales where id = pg_temp.sid(75)));

  -- the discount does not cover the value of the points: recorded as 0 points
  perform pg_temp.sell(pg_temp.sid(25), cashier_id, null, 'cash', 500,
    jsonb_build_array(pg_temp.ln(p1, 5, 1000)),
    jsonb_build_object('customer_id', fatima, 'redeem_points', 100, 'card_token', token));
  select * into s from public.sales where id = pg_temp.sid(25);
  perform pg_temp.eq('claim not covered: 0 points', s.loyalty_points_redeemed, 0);
  perform pg_temp.eq('claim not covered: 0 discount', s.loyalty_discount_cents, 0);
  perform pg_temp.ok('claim not covered flagged', s.needs_loyalty_review);
  perform pg_temp.eqt('claim not covered reason', pg_temp.reason(pg_temp.sid(25)), 'discount_below_value');
  perform pg_temp.eq('claim not covered: no ledger row', pg_temp.led(pg_temp.sid(25), 'redeem'), 0);

  -- an unreadable claim never fails the sale
  perform pg_temp.sell(pg_temp.sid(26), cashier_id, null, 'cash', 0,
    jsonb_build_array(pg_temp.ln(p1, 1, 1000)),
    jsonb_build_object('customer_id', fatima, 'redeem_points', 'abc'));
  perform pg_temp.ok('garbage claim: sale recorded and flagged',
    (select needs_loyalty_review from public.sales where id = pg_temp.sid(26)));

  -- not a member: the discount stands, flagged, nothing to charge
  insert into public.customers (id, name) values ('5d000000-0000-0000-0000-000000000003', 'Plain customer');
  perform pg_temp.sell(pg_temp.sid(27), cashier_id, null, 'cash', 1000,
    jsonb_build_array(pg_temp.ln(p1, 5, 1000)),
    jsonb_build_object('customer_id', '5d000000-0000-0000-0000-000000000003'::uuid, 'redeem_points', 100, 'card_token', 'x'));
  perform pg_temp.eqt('not member reason', pg_temp.reason(pg_temp.sid(27)), 'not_member');
  perform pg_temp.eq('not member: no ledger', pg_temp.led(pg_temp.sid(27), 'redeem'), 0);
  perform pg_temp.eq('not member: claim kept on the sale',
    (select loyalty_points_redeemed from public.sales where id = pg_temp.sid(27)), 100);

  -- loyalty disabled but a claim arrives (device had old settings)
  update public.store_settings set loyalty_enabled = false;
  perform pg_temp.sell(pg_temp.sid(28), cashier_id, null, 'cash', 1000,
    jsonb_build_array(pg_temp.ln(p1, 5, 1000)),
    jsonb_build_object('customer_id', fatima, 'redeem_points', 100, 'card_token', token));
  perform pg_temp.eqt('disabled reason', pg_temp.reason(pg_temp.sid(28)), 'disabled');
  perform pg_temp.eq('disabled earns nothing', pg_temp.led(pg_temp.sid(28), 'earn'), 0);
  update public.store_settings set loyalty_enabled = true;

  -- replay of a redeeming sale: nothing doubled
  perform pg_temp.sell(pg_temp.sid(10), cashier_id, null, 'cash', 2000,
    jsonb_build_array(pg_temp.ln(p1, 5, 1000)),
    jsonb_build_object('customer_id', fatima, 'redeem_points', 200, 'card_token', token));
  perform pg_temp.eq('replay redeem unchanged', pg_temp.led(pg_temp.sid(10), 'redeem'), -200);
end $$;

---------------------------------------------------------------- returns
do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id uuid := '00000000-0000-0000-0000-0000000000bb';
  fatima uuid := (select id from public.customers where phone_e164 = '+212612345678');
  token text := (select card_token from public.customers where phone_e164 = '+212612345678');
  p1 uuid := '5c000000-0000-0000-0000-000000000001';
  px uuid := '5c000000-0000-0000-0000-000000000003';
  sale uuid := pg_temp.sid(40);
  line_a uuid;
  line_y uuid;
  start_bal bigint;
  adj bigint;
begin
  update public.store_settings set loyalty_cents_per_point = 100;
  start_bal := pg_temp.bal(fatima);

  -- X (P1) 2 x 1000 and Y (excluded) 2 x 1000, discount 1000 all in points:
  -- each side is paid 1500. Earn floor(1500/100) = 15, redeem -100.
  perform pg_temp.sell(sale, cashier_id, null, 'cash', 1000,
    jsonb_build_array(pg_temp.ln(p1, 2, 1000), pg_temp.ln(px, 2, 1000)),
    jsonb_build_object('customer_id', fatima, 'redeem_points', 100, 'card_token', token));
  perform pg_temp.eq('earn 15', pg_temp.led(sale, 'earn'), 15);
  perform pg_temp.eq('redeem -100', pg_temp.led(sale, 'redeem'), -100);
  select id into line_a from public.sale_items where sale_id = sale and product_id = p1;
  select id into line_y from public.sale_items where sale_id = sale and product_id = px;

  -- return 1: one of the two P1 (refund 750). Eligible left 750 -> earn 7;
  -- paid left 2250 of 3000 -> redeemed 75. Net 7 - 75 = -68, was -85: +17.
  perform pg_temp.as_user(owner_id);
  perform public.record_sale_return(pg_temp.sid(41), sale,
    jsonb_build_array(jsonb_build_object('sale_item_id', line_a, 'quantity', 1)),
    'wrong_item', null, 'cash');
  select coalesce(sum(points), 0) into adj from public.loyalty_ledger where sale_id = sale and kind = 'sale_adjust';
  perform pg_temp.eq('return 1 delta', adj, 17);
  perform pg_temp.ok('return id filled', (select return_id = pg_temp.sid(41) from public.loyalty_ledger
    where sale_id = sale and kind = 'sale_adjust'));
  perform pg_temp.eq('balance after return 1', pg_temp.bal(fatima), start_bal + 15 - 100 + 17);

  -- resync is idempotent
  perform pg_temp.eq('resync again', public.loyalty_resync_sale(sale, null), 0);
  perform pg_temp.eq('resync again 2', public.loyalty_resync_sale(sale, null), 0);
  perform pg_temp.eq('still one adjust row', (select count(*) from public.loyalty_ledger
    where sale_id = sale and kind = 'sale_adjust'), 1);

  -- return 2: one excluded unit (refund 750): earn stays 7, paid left 1500 of
  -- 3000 -> redeemed 50. Net 7 - 50 = -43, was -68: +25.
  perform public.record_sale_return(pg_temp.sid(42), sale,
    jsonb_build_array(jsonb_build_object('sale_item_id', line_y, 'quantity', 1)),
    'damaged', null, 'cash');
  select coalesce(sum(points), 0) into adj from public.loyalty_ledger
  where sale_id = sale and kind = 'sale_adjust' and return_id = pg_temp.sid(42);
  perform pg_temp.eq('return 2 delta', adj, 25);
  perform pg_temp.eq('balance after return 2', pg_temp.bal(fatima), start_bal + 15 - 100 + 17 + 25);

  -- the rest in one return (two lines, one statement): everything comes back
  perform public.record_sale_return(pg_temp.sid(43), sale,
    jsonb_build_array(
      jsonb_build_object('sale_item_id', line_a, 'quantity', 1),
      jsonb_build_object('sale_item_id', line_y, 'quantity', 1)),
    'other', 'rest', 'cash');
  perform pg_temp.eq('net of the whole sale is zero', (select coalesce(sum(points), 0) from public.loyalty_ledger
    where sale_id = sale), 0);
  perform pg_temp.eq('balance as before the sale', pg_temp.bal(fatima), start_bal);
  perform pg_temp.eq('resync after all returns', public.loyalty_resync_sale(sale, null), 0);

  -- a sale that never earned (disabled at the time) is not touched by a return
  update public.store_settings set loyalty_enabled = false;
  perform pg_temp.sell(pg_temp.sid(44), cashier_id, null, 'cash', 0,
    jsonb_build_array(pg_temp.ln(p1, 2, 1000)), jsonb_build_object('customer_id', fatima));
  update public.store_settings set loyalty_enabled = true;
  perform pg_temp.as_user(owner_id);
  perform public.record_sale_return(pg_temp.sid(45), pg_temp.sid(44),
    jsonb_build_array(jsonb_build_object(
      'sale_item_id', (select id from public.sale_items where sale_id = pg_temp.sid(44)), 'quantity', 1)),
    'damaged', null, 'cash');
  perform pg_temp.eq('no adjust for a sale that never earned', (select count(*) from public.loyalty_ledger
    where sale_id = pg_temp.sid(44)), 0);

  -- the earn target uses the rate stamped on the sale, not today's rate
  update public.store_settings set loyalty_cents_per_point = 50;
  perform pg_temp.sell(pg_temp.sid(46), cashier_id, null, 'cash', 0,
    jsonb_build_array(pg_temp.ln(p1, 2, 1000)), jsonb_build_object('customer_id', fatima));
  perform pg_temp.eq('earn at 50 cents per point', pg_temp.led(pg_temp.sid(46), 'earn'), 40);
  update public.store_settings set loyalty_cents_per_point = 1000;
  perform pg_temp.as_user(owner_id);
  perform public.record_sale_return(pg_temp.sid(47), pg_temp.sid(46),
    jsonb_build_array(jsonb_build_object(
      'sale_item_id', (select id from public.sale_items where sale_id = pg_temp.sid(46)), 'quantity', 1)),
    'damaged', null, 'cash');
  perform pg_temp.eq('half of the points back using the stamped rate',
    (select coalesce(sum(points), 0) from public.loyalty_ledger where sale_id = pg_temp.sid(46)), 20);
end $$;

---------------------------------------------------------------- void
do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id uuid := '00000000-0000-0000-0000-0000000000bb';
  fatima uuid := (select id from public.customers where phone_e164 = '+212612345678');
  token text := (select card_token from public.customers where phone_e164 = '+212612345678');
  p1 uuid := '5c000000-0000-0000-0000-000000000001';
  sale uuid := pg_temp.sid(50);
  start_bal bigint;
begin
  update public.store_settings set loyalty_cents_per_point = 100;
  start_bal := pg_temp.bal(fatima);
  -- 3000 basket, 1000 in points: paid 2000, earn 20, redeem -100
  perform pg_temp.sell(sale, cashier_id, null, 'cash', 1000,
    jsonb_build_array(pg_temp.ln(p1, 3, 1000)),
    jsonb_build_object('customer_id', fatima, 'redeem_points', 100, 'card_token', token));
  perform pg_temp.eq('before void', pg_temp.bal(fatima), start_bal + 20 - 100);

  perform pg_temp.as_user(owner_id);
  perform public.void_sale(sale, 'test');
  perform pg_temp.eq('void gives everything back', pg_temp.bal(fatima), start_bal);
  perform pg_temp.eq('sale nets to zero', (select coalesce(sum(points), 0) from public.loyalty_ledger where sale_id = sale), 0);
  perform pg_temp.eq('void adjust row', (select count(*) from public.loyalty_ledger
    where sale_id = sale and kind = 'sale_adjust' and return_id is null), 1);

  perform public.void_sale(sale, 'again');
  perform pg_temp.eq('second void writes nothing', (select count(*) from public.loyalty_ledger
    where sale_id = sale and kind = 'sale_adjust'), 1);
  perform pg_temp.eq('resync of a voided sale', public.loyalty_resync_sale(sale, null), 0);
  update public.store_settings set loyalty_cents_per_point = 1000;
end $$;

---------------------------------------------------------------- bonus points
do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id uuid := '00000000-0000-0000-0000-0000000000bb';
  fatima uuid := (select id from public.customers where phone_e164 = '+212612345678');
  pb uuid := '5c000000-0000-0000-0000-000000000006';
  pbe uuid := '5c000000-0000-0000-0000-000000000007';
  pbx uuid := '5c000000-0000-0000-0000-000000000008';
  pk uuid := '5c000000-0000-0000-0000-000000000009';
  line_pb uuid;
  adj bigint;
  adj_bonus bigint;
  n int;
begin
  update public.store_settings set loyalty_cents_per_point = 100;

  -- the stamp ignores whatever an insert says
  insert into public.sales (id, cashier_id, payment_method, discount_cents, total_cents, occurred_at)
  values (pg_temp.sid(69), cashier_id, 'cash', 0, 1000, now());
  insert into public.sale_items (sale_id, product_id, quantity, unit_price_cents, line_total_cents,
                                 loyalty_eligible, loyalty_bonus_per_unit)
  values (pg_temp.sid(69), pbx, 1, 1000, 1000, true, 99);
  perform pg_temp.ok('stamp overrides the payload', exists (
    select 1 from public.sale_items where sale_id = pg_temp.sid(69)
      and not loyalty_eligible and loyalty_bonus_per_unit = 0));

  -- 3 x PB (+20 each), PBE (bonus ended), 2 x PBX (excluded), 0.750 kg
  perform pg_temp.sell(pg_temp.sid(70), cashier_id, fatima, 'cash', 0,
    jsonb_build_array(pg_temp.ln(pb, 3, 1000), pg_temp.ln(pbe, 1, 1000),
                      pg_temp.ln(pbx, 2, 1000), pg_temp.ln(pk, 0.750, 2000)),
    jsonb_build_object('customer_id', fatima));
  -- base: 3000 + 1000 + 1500 = 5500 / 100 = 55 (PBX excluded); bonus 3 x 20 = 60
  perform pg_temp.eq('earn = base + bonus', pg_temp.led(pg_temp.sid(70), 'earn'), 115);
  perform pg_temp.eq('bonus part', (select bonus_points from public.loyalty_ledger
    where sale_id = pg_temp.sid(70) and kind = 'earn'), 60);
  perform pg_temp.eq('one earn row', (select count(*) from public.loyalty_ledger
    where sale_id = pg_temp.sid(70) and kind = 'earn'), 1);
  perform pg_temp.eq('stamped bonus on PB', (select loyalty_bonus_per_unit from public.sale_items
    where sale_id = pg_temp.sid(70) and product_id = pb), 20);
  perform pg_temp.eq('ended bonus stamped 0', (select loyalty_bonus_per_unit from public.sale_items
    where sale_id = pg_temp.sid(70) and product_id = pbe), 0);
  perform pg_temp.eq('excluded bonus stamped 0', (select loyalty_bonus_per_unit from public.sale_items
    where sale_id = pg_temp.sid(70) and product_id = pbx), 0);

  -- kg: 2.4 kg earns 2 x 5 bonus; 0.750 above earned none
  perform pg_temp.sell(pg_temp.sid(71), cashier_id, fatima, 'cash', 0,
    jsonb_build_array(pg_temp.ln(pk, 2.4, 2000)), jsonb_build_object('customer_id', fatima));
  perform pg_temp.eq('kg earn = 48 base + 10 bonus', pg_temp.led(pg_temp.sid(71), 'earn'), 58);
  perform pg_temp.eq('kg bonus floor(2.4) x 5', (select bonus_points from public.loyalty_ledger
    where sale_id = pg_temp.sid(71) and kind = 'earn'), 10);

  -- the owner changes the product after the sale: exclusion on, bonus off. A
  -- partial return still reverses using the STAMPED values.
  perform pg_temp.as_user(owner_id);
  update public.products set loyalty_excluded = true, loyalty_bonus_points = 0 where id = pb;
  select id into line_pb from public.sale_items where sale_id = pg_temp.sid(70) and product_id = pb;
  perform public.record_sale_return(pg_temp.sid(72), pg_temp.sid(70),
    jsonb_build_array(jsonb_build_object('sale_item_id', line_pb, 'quantity', 1)),
    'damaged', null, 'cash');
  -- base 55 -> 45 (1000 refunded), bonus 60 -> 40
  select coalesce(sum(points), 0), coalesce(sum(bonus_points), 0) into adj, adj_bonus
  from public.loyalty_ledger where sale_id = pg_temp.sid(70) and kind = 'sale_adjust';
  perform pg_temp.eq('return delta', adj, -30);
  perform pg_temp.eq('return bonus delta', adj_bonus, -20);
  perform pg_temp.eq('resync again', public.loyalty_resync_sale(pg_temp.sid(70), null), 0);

  -- a void takes the rest of it back, bonus included
  perform public.record_sale_return(pg_temp.sid(73), pg_temp.sid(70),
    jsonb_build_array(jsonb_build_object('sale_item_id', line_pb, 'quantity', 2)),
    'damaged', null, 'cash');
  select coalesce(sum(bonus_points), 0) into adj_bonus from public.loyalty_ledger
  where sale_id = pg_temp.sid(70);
  perform pg_temp.eq('bonus left after returning every PB unit', adj_bonus, 0);
  update public.products set loyalty_excluded = false, loyalty_bonus_points = 20 where id = pb;
  update public.store_settings set loyalty_cents_per_point = 1000;
end $$;

---------------------------------------------------------------- daily review
do $$
declare
  cashier_id uuid := '00000000-0000-0000-0000-0000000000bb';
  p1 uuid := '5c000000-0000-0000-0000-000000000001';
  a uuid;
  b uuid;
begin
  update public.store_settings set loyalty_cents_per_point = 100, loyalty_daily_review_points = 5;
  perform pg_temp.as_user(cashier_id);
  select customer_id into a from public.loyalty_join('0699900001', 'Daily A', true);
  select customer_id into b from public.loyalty_join('0699900002', 'Daily B', true);

  perform pg_temp.sell(pg_temp.sid(60), cashier_id, a, 'cash', 0,
    jsonb_build_array(pg_temp.ln(p1, 1, 700)), jsonb_build_object('customer_id', a));
  perform pg_temp.eq('earned 7', pg_temp.led(pg_temp.sid(60), 'earn'), 7);
  perform pg_temp.ok('over the daily threshold flagged', (select needs_loyalty_review from public.sales where id = pg_temp.sid(60)));
  perform pg_temp.ok('activity row', exists (select 1 from public.activity_log
    where entity_id = pg_temp.sid(60) and action = 'loyalty_over_daily'));

  perform pg_temp.sell(pg_temp.sid(61), cashier_id, b, 'cash', 0,
    jsonb_build_array(pg_temp.ln(p1, 1, 400)), jsonb_build_object('customer_id', b));
  perform pg_temp.ok('under the threshold not flagged', not (select needs_loyalty_review from public.sales where id = pg_temp.sid(61)));
  update public.store_settings set loyalty_cents_per_point = 1000, loyalty_daily_review_points = 100;
end $$;

---------------------------------------------------------------- the public card (anon)
do $$
declare
  fatima uuid := (select id from public.customers where phone_e164 = '+212612345678');
  token text := (select card_token from public.customers where phone_e164 = '+212612345678');
  phone_member text := (select card_token from public.customers where phone_e164 = '+212711223344');
  total_points bigint := pg_temp.bal(fatima);
  c jsonb;
  h jsonb;
begin
  execute 'set local role anon';
  c := public.loyalty_card(token);
  if c is null then raise exception 'anon card is null'; end if;
  if (select array_agg(key order by key) from jsonb_object_keys(c) as key)
     is distinct from array['balance_points', 'balance_value_cents', 'cents_per_point', 'first_name', 'history', 'point_value_cents'] then
    raise exception 'unexpected keys in the public card: %', c;
  end if;
  perform pg_temp.eqt('first word only', c ->> 'first_name', 'Fatima');
  perform pg_temp.eq('balance', (c ->> 'balance_points')::bigint, total_points);
  perform pg_temp.eq('value', (c ->> 'balance_value_cents')::bigint, total_points * 10);
  perform pg_temp.eq('point value', (c ->> 'point_value_cents')::bigint, 10);
  perform pg_temp.eq('ten rows at most', jsonb_array_length(c -> 'history'), 10);
  for h in select * from jsonb_array_elements(c -> 'history') loop
    if (select array_agg(key order by key) from jsonb_object_keys(h) as key)
       is distinct from array['created_at', 'kind', 'points'] then
      raise exception 'unexpected keys in a history row: %', h;
    end if;
  end loop;
  -- A Moroccan mobile number in any form (+212 6xx…, 06xx…), or a phone key.
  -- Not a bare '212': a timestamp such as 07:12:17.0212… contains it.
  if c::text ~ '(\+?212|0)[5-7][0-9]{8}|phone' then
    raise exception 'phone leaked in the public card: %', c;
  end if;

  -- a member whose name is only the phone shows no name
  c := public.loyalty_card(phone_member);
  if c ->> 'first_name' is not null then raise exception 'phone shown as first name: %', c; end if;

  if public.loyalty_card('does-not-exist') is not null then raise exception 'unknown token returned data'; end if;
  if public.loyalty_card(null) is not null then raise exception 'null token returned data'; end if;

  -- and nothing else is open to anon
  begin
    perform * from public.loyalty_lookup('0612345678');
    raise exception 'anon can look up';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.loyalty_resync_sale(pg_temp.sid(1), null);
    raise exception 'anon can resync';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.customers;
    raise exception 'anon can read customers';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.loyalty_ledger;
    raise exception 'anon can read the ledger';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
end $$;

---------------------------------------------------------------- roles
do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id uuid := '00000000-0000-0000-0000-0000000000bb';
  fatima uuid := (select id from public.customers where phone_e164 = '+212612345678');
  token text := (select card_token from public.customers where phone_e164 = '+212612345678');
  n int;
  r jsonb;
  old_token text;
  new_token text;
begin
  -- cashier
  perform pg_temp.as_user(cashier_id);
  execute 'set local role authenticated';

  begin
    perform public.loyalty_adjust(fatima, 10, 'cheat');
    raise exception 'cashier adjusted points';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.loyalty_reset_card(fatima);
    raise exception 'cashier reset a card';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.report_loyalty(now() - interval '1 day', now() + interval '1 day');
    raise exception 'cashier read the loyalty report';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform * from public.loyalty_member_details(fatima);
    raise exception 'cashier read member details';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform * from public.loyalty_balances();
    raise exception 'cashier read balances';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.loyalty_resync_sale(pg_temp.sid(1), null);
    raise exception 'cashier called the internal resync';
  exception when insufficient_privilege then null;
  end;

  -- the secrets are not readable through the table; the ordinary columns are
  begin
    perform card_token from public.customers;
    raise exception 'cashier read card_token';
  exception when insufficient_privilege then null;
  end;
  begin
    perform phone_e164 from public.customers;
    raise exception 'cashier read phone_e164';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.customers;
    raise exception 'cashier select * on customers';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from (select id, name, phone, credit_limit_cents, loyalty_joined_at from public.customers) q;
  if n = 0 then raise exception 'cashier lost read access to customers'; end if;
  -- ... nor forge membership
  begin
    insert into public.customers (name, phone_e164) values ('forged', '+212600000001');
    raise exception 'cashier wrote phone_e164';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.customers (name, card_token) values ('forged', 'abc');
    raise exception 'cashier wrote card_token';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.customers set loyalty_joined_at = now() where id = fatima;
    raise exception 'cashier wrote loyalty_joined_at';
  exception when insufficient_privilege then null;
  end;
  -- Pay Later still creates a customer the way the app does
  insert into public.customers (name, phone) values ('Pay later client', '0600000099');

  -- ledger: no read (RLS), no write
  select count(*) into n from public.loyalty_ledger;
  if n <> 0 then raise exception 'cashier reads the ledger (% rows)', n; end if;
  begin
    insert into public.loyalty_ledger (customer_id, kind, points) values (fatima, 'adjust', 1000);
    raise exception 'cashier wrote the ledger';
  exception when insufficient_privilege then null;
  end;

  -- products: the flag is visible in the cashier view, not writable
  if (select loyalty_excluded from public.products_cashier_view where id = '5c000000-0000-0000-0000-000000000003') is not true then
    raise exception 'cashier view should show the exclusion';
  end if;
  update public.products set loyalty_excluded = true where id = '5c000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'cashier changed an exclusion'; end if;
  update public.categories set loyalty_excluded = true where id = '5b000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'cashier changed a category exclusion'; end if;
  update public.products set loyalty_bonus_points = 500 where id = '5c000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'cashier changed a bonus'; end if;
  perform loyalty_bonus_points, loyalty_bonus_until from public.products_cashier_view limit 1;
  update public.store_settings set loyalty_enabled = false;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'cashier changed loyalty settings'; end if;
  execute 'reset role';

  -- owner
  perform pg_temp.as_user(owner_id);
  execute 'set local role authenticated';
  if (select card_token from public.loyalty_member_details(fatima)) is distinct from token then
    raise exception 'owner member details token mismatch';
  end if;
  if (select count(*) from public.loyalty_balances()) < 3 then raise exception 'owner balances'; end if;
  if (select count(*) from public.loyalty_ledger) = 0 then raise exception 'owner cannot read the ledger'; end if;
  update public.products set loyalty_excluded = true where id = '5c000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'owner cannot set an exclusion'; end if;
  update public.store_settings set loyalty_point_value_cents = 10, loyalty_welcome_points = 0;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'owner cannot update loyalty settings'; end if;

  begin
    perform public.loyalty_adjust(fatima, 0, 'nothing');
    raise exception 'zero adjustment accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.loyalty_adjust(fatima, 5, '   ');
    raise exception 'adjustment without note accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.loyalty_adjust(fatima, 5, repeat('x', 201));
    raise exception 'long note accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.loyalty_adjust('5d000000-0000-0000-0000-000000000003', 5, 'not a member');
    raise exception 'adjusted a non-member';
  exception when sqlstate '22023' then null;
  end;

  -- a new card: the old QR stops working
  old_token := token;
  new_token := public.loyalty_reset_card(fatima);
  if new_token = old_token or char_length(new_token) <> 22 then raise exception 'reset card gave %', new_token; end if;
  if exists (select 1 from public.loyalty_card_customer(old_token)) then raise exception 'old token still works'; end if;
  if not exists (select 1 from public.loyalty_card_customer(new_token)) then raise exception 'new token does not work'; end if;
  perform pg_temp.ok('old token no longer proves',
    public.loyalty_check_redeem(fatima, 100, old_token) ->> 'reason' = 'no_proof');

  -- the report
  r := public.report_loyalty(now() - interval '1 day', now() + interval '1 day');
  if (select array_agg(key order by key) from jsonb_object_keys(r) as key) is distinct from
     array['all_sales_cents', 'member_sales_cents', 'member_sales_count', 'members_new', 'members_total',
           'points_adjusted', 'points_bonus', 'points_earned', 'points_redeemed', 'top_bonus_products',
           'top_members', 'value_redeemed_cents'] then
    raise exception 'unexpected report keys: %', r;
  end if;
  if (r ->> 'members_total')::int < 5 or (r ->> 'members_new')::int < 5 then raise exception 'members: %', r; end if;
  if (r ->> 'points_redeemed')::int < 200 or (r ->> 'value_redeemed_cents')::bigint < 2000 then raise exception 'redeemed: %', r; end if;
  if (r ->> 'points_earned')::int <= 0 then raise exception 'earned: %', r; end if;
  -- bonus: 60 + 10 earned, 20 + 40 taken back by the returns of sale 70
  if (r ->> 'points_bonus')::int <> 10 then raise exception 'bonus: %', r; end if;
  if r -> 'top_bonus_products' -> 0 ->> 'product_name' <> 'Loy PB bonus'
     or (r -> 'top_bonus_products' -> 0 ->> 'bonus_points')::int <> 60
     or (select count(*) from jsonb_object_keys(r -> 'top_bonus_products' -> 0)) <> 2 then
    raise exception 'top bonus products: %', r;
  end if;
  if (r ->> 'member_sales_cents')::bigint > (r ->> 'all_sales_cents')::bigint then raise exception 'member > all: %', r; end if;
  if (r ->> 'member_sales_count')::int < 5 then raise exception 'member sales: %', r; end if;
  if jsonb_array_length(r -> 'top_members') not between 1 and 5 then raise exception 'top: %', r; end if;
  if (select count(*) from jsonb_object_keys(r -> 'top_members' -> 0)) <> 3 then
    raise exception 'top member keys: %', r;
  end if;
  execute 'reset role';
end $$;


-- Points sit inside the sale discount, which is spread over the discountable
-- lines only. Found in the browser: a big points claim on a basket of mostly
-- "no discount" items gave the discountable lines a negative share, and a return
-- of a no-discount item refunded money that had been paid with points.
-- PD takes discounts (10.00 DH), PN does not (30.00 DH).
insert into public.products (id, name, selling_price_cents, current_cost_cents, stock_quantity, discount_override)
values ('5c000000-0000-0000-0000-0000000000d1', 'Loy PD discountable', 1000, 600, 1000, 'allow'),
       ('5c000000-0000-0000-0000-0000000000d2', 'Loy PN no discount', 3000, 2000, 1000, 'block');

do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id uuid := '00000000-0000-0000-0000-0000000000bb';
  fatima uuid := (select id from public.customers where phone_e164 = '+212612345678');
  token text := (select card_token from public.customers where phone_e164 = '+212612345678');
  pd uuid := '5c000000-0000-0000-0000-0000000000d1';
  pn uuid := '5c000000-0000-0000-0000-0000000000d2';
  line_pd uuid;
  line_pn uuid;
  start_bal bigint;
begin
  perform pg_temp.as_user(owner_id);
  perform public.loyalty_adjust(fatima, 300, 'for the discount-base test');
  start_bal := pg_temp.bal(fatima);

  -- 15.00 DH of points: more than the 10.00 DH of discountable items
  perform pg_temp.sell(pg_temp.sid(80), cashier_id, null, 'cash', 1500,
    jsonb_build_array(pg_temp.ln(pd, 1, 1000), pg_temp.ln(pn, 1, 3000)),
    jsonb_build_object('customer_id', fatima, 'redeem_points', 150, 'card_token', token));
  perform pg_temp.eqt('points above the discountable items are flagged',
    pg_temp.reason(pg_temp.sid(80)), 'over_eligible');

  -- 10.00 DH of points: exactly the discountable item, fine
  perform pg_temp.sell(pg_temp.sid(81), cashier_id, null, 'cash', 1000,
    jsonb_build_array(pg_temp.ln(pd, 1, 1000), pg_temp.ln(pn, 1, 3000)),
    jsonb_build_object('customer_id', fatima, 'redeem_points', 100, 'card_token', token));
  -- (Fatima is over the daily review threshold by now; only the redemption
  -- itself must be confirmed.)
  perform pg_temp.ok('points up to the discountable items are confirmed',
    pg_temp.reason(pg_temp.sid(81)) is null);
  -- paid in money: PN 30.00, PD 0.00 -> earn floor(3000 / 1000) = 3
  perform pg_temp.eq('earned on money only', pg_temp.led(pg_temp.sid(81), 'earn'), 3);
  select id into line_pd from public.sale_items where sale_id = pg_temp.sid(81) and product_id = pd;
  select id into line_pn from public.sale_items where sale_id = pg_temp.sid(81) and product_id = pn;

  -- Return the no-discount item: its 30.00 DH was paid in money and comes back
  -- in money; the points paid for PD, which is kept, so no point comes back.
  -- Its 3 earned points go.
  perform pg_temp.as_user(owner_id);
  perform public.record_sale_return(pg_temp.sid(82), pg_temp.sid(81),
    jsonb_build_array(jsonb_build_object('sale_item_id', line_pn, 'quantity', 1)),
    'customer_changed_mind', null, 'cash');
  perform pg_temp.eq('no-discount item refunded what was paid for it',
    (select refund_cents from public.sale_returns where id = pg_temp.sid(82)), 3000);
  perform pg_temp.eq('no points back for an item paid in money; earned points go',
    (select coalesce(sum(points), 0) from public.loyalty_ledger
      where sale_id = pg_temp.sid(81) and kind = 'sale_adjust'), -3);

  -- Return the item the points paid for: nothing to refund in money, all 100
  -- points come back.
  perform public.record_sale_return(pg_temp.sid(83), pg_temp.sid(81),
    jsonb_build_array(jsonb_build_object('sale_item_id', line_pd, 'quantity', 1)),
    'customer_changed_mind', null, 'cash');
  perform pg_temp.eq('item paid with points refunds no money',
    (select refund_cents from public.sale_returns where id = pg_temp.sid(83)), 0);
  perform pg_temp.eq('its points come back',
    (select coalesce(sum(points), 0) from public.loyalty_ledger
      where sale_id = pg_temp.sid(81) and kind = 'sale_adjust'), -3 + 100);
  perform pg_temp.eq('balance: sale 80 as recorded (flagged), then net zero for sale 81',
    pg_temp.bal(fatima), start_bal - 150 + pg_temp.led(pg_temp.sid(80), 'earn') - 100 + 3 - 3 + 100);
end $$;

rollback;
