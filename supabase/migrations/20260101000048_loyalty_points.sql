-- Loyalty points (cardless): the customer's Moroccan mobile number is the card.
-- Design: docs/LOYALTY.md.
--
--   * 1 point per full 10.00 DH paid on eligible items, 100 points = 10.00 DH
--     (all four rates are owner settings). Points are computed HERE, on the
--     server, from the stamped sale lines; a device never sends points to earn.
--   * Every change is a row of loyalty_ledger and a balance is sum(points).
--     Nothing is edited or deleted. A sale has at most one 'earn' row and one
--     'redeem' row; returns and voids add a 'sale_adjust' delta (idempotent
--     resync, see loyalty_resync_sale).
--   * Spending points is a DISCOUNT: its value is part of sales.discount_cents
--     and sales.loyalty_discount_cents says how much of it was points, so the
--     reports, receipts, sale_line_economics and the return refunds need no
--     change (a return refunds the money paid, never the points part). The
--     cashier discount limit and the discount review do not count it.
--   * The device enforces, the server flags: record_sale NEVER fails because of
--     loyalty (an offline sale cannot be un-rung). A redemption the server
--     cannot confirm is still recorded and the sale gets needs_loyalty_review
--     plus an activity_log row, like the discount and credit reviews.
--
-- Bonus points per product (often supplier-funded promos): products carry
-- loyalty_bonus_points per unit sold and an optional end date. A line earns
-- floor(quantity) x bonus (a 0.750 kg line earns none, 2.4 kg earns 2), only
-- while the bonus runs at the sale's occurred_at, and never on an excluded
-- product (exclusion wins). The bonus is added to the sale's single 'earn' row;
-- loyalty_ledger.bonus_points says how much of it was bonus, for the report.
--
-- Eligibility, the bonus and the rate that applied are STAMPED when the sale is
-- recorded (sale_items.loyalty_eligible / loyalty_bonus_per_unit by a BEFORE
-- INSERT trigger, never from the payload; sales.loyalty_cents_per_point), so a
-- later change of the owner's rules, exclusions or bonuses never rewrites what
-- an old sale earned when one of its items is returned or the sale is voided.
-- Earning and the resync read ONLY the stamped values.
--
-- Categories: excluding a main category also excludes its sub-categories
-- (a sub-category is excluded when it or its parent is).
--
-- Privacy: customers.card_token (the proof) and phone_e164 are not readable by
-- any signed-in user through the table. customers is moved to column-level
-- grants, so the existing app queries keep working and nothing else leaks; the
-- token is returned only by loyalty_join and, for the owner, by
-- loyalty_member_details.
--
-- Append-only: new tables, columns, functions; record_sale is replaced with
-- migration 046's body plus the loyalty blocks (and the one change to the
-- discount reviews described there).

-------------------------------------------------------------------------------
-- 1. Settings and exclusions
-------------------------------------------------------------------------------
alter table public.store_settings
  add column loyalty_enabled boolean not null default false,
  add column loyalty_cents_per_point integer not null default 1000
    check (loyalty_cents_per_point > 0),
  add column loyalty_point_value_cents integer not null default 10
    check (loyalty_point_value_cents > 0),
  add column loyalty_min_redeem_points integer not null default 100
    check (loyalty_min_redeem_points > 0),
  add column loyalty_daily_review_points integer not null default 100
    check (loyalty_daily_review_points > 0),
  add column loyalty_welcome_points integer not null default 0
    check (loyalty_welcome_points >= 0);
-- store_settings is already writable by the owner only (policy "owner updates
-- store settings"), so the new columns are too.

alter table public.products
  add column loyalty_excluded boolean not null default false,
  add column loyalty_bonus_points integer not null default 0
    check (loyalty_bonus_points between 0 and 10000),
  add column loyalty_bonus_until timestamptz;
alter table public.categories
  add column loyalty_excluded boolean not null default false;

-- Owner writes only: the existing owner-only policies cover rows, the column
-- grants cover columns (same way as discount_override and the category fields).
grant insert (loyalty_excluded, loyalty_bonus_points, loyalty_bonus_until),
      update (loyalty_excluded, loyalty_bonus_points, loyalty_bonus_until)
  on public.products to authenticated;
grant insert (loyalty_excluded), update (loyalty_excluded) on public.categories to authenticated;

-- Cashiers estimate the points on the device, so the view carries the flag (it
-- is not a cost field). create or replace view can only append columns.
create or replace view public.products_cashier_view as
select
  id, name, barcode, category_id, unit,
  selling_price_cents, stock_quantity, low_stock_threshold, active,
  created_at, updated_at, is_low_stock,
  kind, track_stock,
  public.discountable(products) as discountable,
  loyalty_excluded, loyalty_bonus_points, loyalty_bonus_until
from public.products;

-------------------------------------------------------------------------------
-- 2. Members live on customers
-------------------------------------------------------------------------------
alter table public.customers
  add column phone_e164 text unique
    check (phone_e164 ~ '^\+212[5-7][0-9]{8}$'),
  add column loyalty_joined_at timestamptz,
  add column loyalty_consent_at timestamptz,
  add column card_token text unique,
  add constraint customers_member_has_card
    check (loyalty_joined_at is null or (card_token is not null and phone_e164 is not null));

-- Column-level grants. Before: select/insert/update on the whole table for
-- every signed-in user (rows are limited by the policies). Now a cashier can
-- read and write the columns the app always used, and can NOT read card_token or
-- phone_e164, nor forge membership by writing the new columns. The security
-- definer functions below write them. loyalty_joined_at (is this a member?) is
-- readable, nothing else of the program is.
revoke select, insert, update on public.customers from authenticated;
grant select (id, name, phone, created_at, credit_limit_cents, loyalty_joined_at)
  on public.customers to authenticated;
grant insert (id, name, phone, created_at, credit_limit_cents)
  on public.customers to authenticated;
grant update (name, phone, credit_limit_cents)
  on public.customers to authenticated;

-------------------------------------------------------------------------------
-- 3. Sales columns and stamps
-------------------------------------------------------------------------------
alter table public.sales
  add column loyalty_points_redeemed integer not null default 0
    check (loyalty_points_redeemed >= 0),
  add column loyalty_discount_cents bigint not null default 0
    check (loyalty_discount_cents >= 0),
  add column needs_loyalty_review boolean not null default false,
  -- The rate in force when the sale earned (null = nothing was earned).
  add column loyalty_cents_per_point integer
    check (loyalty_cents_per_point > 0),
  add constraint sales_loyalty_discount_within_discount
    check (loyalty_discount_cents <= discount_cents);

-- Stamped at insert (trigger below): does this line count for points, and how
-- many bonus points per unit did it carry at the sale's time.
alter table public.sale_items
  add column loyalty_eligible boolean not null default false,
  add column loyalty_bonus_per_unit integer not null default 0
    check (loyalty_bonus_per_unit >= 0);

-------------------------------------------------------------------------------
-- 4. The ledger
-------------------------------------------------------------------------------
create table public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  sale_id uuid references public.sales (id),
  return_id uuid references public.sale_returns (id),
  kind text not null check (kind in ('earn', 'redeem', 'sale_adjust', 'adjust')),
  points integer not null check (points <> 0),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  note text check (char_length(note) <= 200),
  -- How much of an 'earn' row (or of a return's delta) is product bonus.
  bonus_points integer not null default 0,
  check (kind in ('earn', 'sale_adjust') or bonus_points = 0),
  check (kind <> 'earn' or (bonus_points >= 0 and bonus_points <= points))
);
create index idx_loyalty_ledger_customer on public.loyalty_ledger (customer_id, created_at);
create index idx_loyalty_ledger_sale on public.loyalty_ledger (sale_id) where sale_id is not null;
-- A sale earns once and redeems once, whatever happens to retries.
create unique index uq_loyalty_ledger_sale_earn
  on public.loyalty_ledger (sale_id) where kind = 'earn';
create unique index uq_loyalty_ledger_sale_redeem
  on public.loyalty_ledger (sale_id) where kind = 'redeem';

alter table public.loyalty_ledger enable row level security;
create policy "owner reads loyalty ledger" on public.loyalty_ledger
  for select using (public.is_owner());
revoke all on public.loyalty_ledger from public, anon, authenticated;
grant select on public.loyalty_ledger to authenticated;

-------------------------------------------------------------------------------
-- 5. Helpers
-------------------------------------------------------------------------------
-- Moroccan mobile/landline number to +212XXXXXXXXX, or null when it is not one.
-- Accepts 06XXXXXXXX, 07..., 05..., +2126..., 002126..., 2126..., 6XXXXXXXX;
-- spaces, dots and dashes are ignored.
create function public.normalize_ma_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when m is null then null
    else '+212' || m[1]
  end
  from (
    select regexp_match(
      regexp_replace(coalesce(p_phone, ''), '[ .\-]', '', 'g'),
      '^(?:\+212|00212|212|0)?([5-7][0-9]{8})$'
    ) as m
  ) t;
$$;
revoke execute on function public.normalize_ma_phone(text) from public, anon;
grant execute on function public.normalize_ma_phone(text) to authenticated;

-- 128 random bits, base64url without padding (22 characters).
create function public.loyalty_new_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_');
$$;
revoke execute on function public.loyalty_new_token() from public, anon, authenticated;

create function public.loyalty_balance(p_customer_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(points), 0)::integer
  from public.loyalty_ledger where customer_id = p_customer_id;
$$;
revoke execute on function public.loyalty_balance(uuid) from public, anon, authenticated;

-- What each line of a sale was paid, from the SAME allocation as
-- sale_line_economics (041: the sale discount is spread over the discountable
-- lines by largest remainder). That view is owner-only and skips voided sales,
-- so a cashier's sale and a voided sale cannot use it; this is the same
-- arithmetic without either filter, for the loyalty functions only.
create function public.loyalty_line_paid(p_sale_id uuid)
returns table (sale_item_id uuid, product_id uuid, paid_cents bigint)
language sql
stable
set search_path = ''
as $$
  with lines as (
    select
      si.id, si.product_id, si.line_total_cents,
      s.discount_cents as sale_discount_cents,
      (si.discountable or not bool_or(si.discountable) over (partition by si.sale_id)) as eligible
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    where si.sale_id = p_sale_id
  ),
  weighted as (
    select *,
      case when eligible then line_total_cents else 0 end as weight,
      sum(case when eligible then line_total_cents else 0 end) over () as lines_total
    from lines
  ),
  exact as (
    select *,
      case when lines_total > 0
        then sale_discount_cents * weight::numeric / lines_total else 0 end as exact_discount
    from weighted
  ),
  floored as (
    select *,
      floor(exact_discount)::bigint as floor_discount,
      exact_discount - floor(exact_discount) as remainder
    from exact
  ),
  ranked as (
    select *,
      case when lines_total > 0
        then sale_discount_cents - sum(floor_discount) over () else 0 end as leftover,
      row_number() over (order by remainder desc, id) as remainder_rank
    from floored
  )
  select
    id, product_id,
    (line_total_cents
      - (floor_discount + case when remainder_rank <= leftover then 1 else 0 end))::bigint
  from ranked;
$$;
revoke execute on function public.loyalty_line_paid(uuid) from public, anon, authenticated;

-- Does a product earn points? Not Divers, not excluded itself, and neither its
-- category nor that category's parent is excluded.
create function public.loyalty_product_earns(p_product_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select p.kind <> 'misc'
         and not p.loyalty_excluded
         and not coalesce(c.loyalty_excluded, false)
         and not coalesce(cp.loyalty_excluded, false)
      from public.products p
      left join public.categories c on c.id = p.category_id
      left join public.categories cp on cp.id = c.parent_id
      where p.id = p_product_id
    ),
    false
  );
$$;
revoke execute on function public.loyalty_product_earns(uuid) from public, anon, authenticated;

-- Stamp eligibility and bonus on every sale line, whatever the payload says.
-- (A separate trigger: the cost/discountable stamp of 041 is left alone.)
create function public.stamp_sale_item_loyalty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bonus integer;
  v_until timestamptz;
  v_at timestamptz;
begin
  new.loyalty_eligible := public.loyalty_product_earns(new.product_id);
  new.loyalty_bonus_per_unit := 0;
  if new.loyalty_eligible then
    select p.loyalty_bonus_points, p.loyalty_bonus_until into v_bonus, v_until
    from public.products p where p.id = new.product_id;
    select s.occurred_at into v_at from public.sales s where s.id = new.sale_id;
    if v_bonus > 0 and (v_until is null or coalesce(v_at, now()) < v_until) then
      new.loyalty_bonus_per_unit := v_bonus;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_sale_item_loyalty() from public, anon, authenticated;

create trigger trg_sale_items_loyalty_stamp
  before insert on public.sale_items
  for each row execute function public.stamp_sale_item_loyalty();

-------------------------------------------------------------------------------
-- 6. Joining, lookup, proof
-------------------------------------------------------------------------------
-- Join (or find) a member by phone. Consent is mandatory and stored.
--   * a customer already holding this phone_e164: becomes a member (their name
--     is kept);
--   * else an old customer whose free-text phone normalises to it: linked;
--   * else a new customer (name defaults to the phone).
-- Returns the card token: the staff member shares the card link from it.
create function public.loyalty_join(p_phone text, p_name text, p_consent boolean)
returns table (customer_id uuid, name text, balance integer, card_token text, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_actor uuid := auth.uid();
  v_phone text := public.normalize_ma_phone(p_phone);
  v_name text := nullif(btrim(p_name), '');
  v_welcome integer;
  v_enabled boolean;
  c public.customers%rowtype;
  v_created boolean := false;
  v_first boolean := false;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles where id = v_actor and role in ('owner', 'cashier')
  ) then
    raise exception 'Authenticated staff required' using errcode = '42501';
  end if;
  if p_consent is distinct from true then
    raise exception 'The customer must agree to join' using errcode = '22023';
  end if;
  if v_phone is null then
    raise exception 'Not a valid Moroccan phone number' using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'The name is too long' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('loyalty_join:' || v_phone));

  select * into c from public.customers where phone_e164 = v_phone for update;
  if not found then
    select * into c from public.customers
    where phone_e164 is null and public.normalize_ma_phone(phone) = v_phone
    order by created_at, id
    limit 1
    for update;
    if found then
      update public.customers set phone_e164 = v_phone where id = c.id returning * into c;
    end if;
  end if;

  if not found then
    insert into public.customers (name, phone, phone_e164)
    values (coalesce(v_name, v_phone), p_phone, v_phone)
    returning * into c;
    v_created := true;
  end if;

  if c.loyalty_joined_at is null then
    update public.customers
    set loyalty_joined_at = now(),
        loyalty_consent_at = now(),
        card_token = coalesce(card_token, public.loyalty_new_token())
    where id = c.id
    returning * into c;
    v_first := true;
  end if;

  if v_first then
    select loyalty_welcome_points into v_welcome from public.store_settings limit 1;
    if coalesce(v_welcome, 0) > 0 then
      insert into public.loyalty_ledger (customer_id, kind, points, created_by, note)
      values (c.id, 'adjust', v_welcome, v_actor, 'welcome');
    end if;
    insert into public.activity_log (actor_id, action, entity_id, details)
    values (v_actor, 'loyalty_join', c.id,
            jsonb_build_object('customer_id', c.id, 'created', v_created));
  end if;

  return query
    select c.id, c.name, public.loyalty_balance(c.id), c.card_token, v_created;
end;
$$;
revoke execute on function public.loyalty_join(text, text, boolean) from public, anon;
grant execute on function public.loyalty_join(text, text, boolean) to authenticated;

-- Look a customer up by phone (a not-yet-member customer is found too, so the
-- cashier can offer to join them).
create function public.loyalty_lookup(p_phone text)
returns table (customer_id uuid, name text, balance integer, is_member boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_phone text := public.normalize_ma_phone(p_phone);
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role in ('owner', 'cashier')
  ) then
    raise exception 'Authenticated staff required' using errcode = '42501';
  end if;
  if v_phone is null then
    return;
  end if;

  return query
    select c.id, c.name,
           case when c.loyalty_joined_at is not null then public.loyalty_balance(c.id) else 0 end,
           c.loyalty_joined_at is not null
    from public.customers c
    where c.phone_e164 = v_phone
       or (c.phone_e164 is null and public.normalize_ma_phone(c.phone) = v_phone)
    order by (c.phone_e164 is not null) desc, c.created_at, c.id
    limit 1;
end;
$$;
revoke execute on function public.loyalty_lookup(text) from public, anon;
grant execute on function public.loyalty_lookup(text) to authenticated;

-- A scanned card QR: the token is the proof of presence.
create function public.loyalty_card_customer(p_token text)
returns table (customer_id uuid, name text, balance integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role in ('owner', 'cashier')
  ) then
    raise exception 'Authenticated staff required' using errcode = '42501';
  end if;
  if p_token is null or btrim(p_token) = '' then
    return;
  end if;

  return query
    select c.id, c.name, public.loyalty_balance(c.id)
    from public.customers c
    where c.card_token = btrim(p_token) and c.loyalty_joined_at is not null;
end;
$$;
revoke execute on function public.loyalty_card_customer(text) from public, anon;
grant execute on function public.loyalty_card_customer(text) to authenticated;

-- What the device asks before taking payment in points. The cap by the basket
-- (eligible amount) is checked by the device, which knows it, and by record_sale.
create function public.loyalty_check_redeem(p_customer_id uuid, p_points integer, p_card_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.store_settings%rowtype;
  c public.customers%rowtype;
  v_balance integer := 0;
  v_reason text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role in ('owner', 'cashier')
  ) then
    raise exception 'Authenticated staff required' using errcode = '42501';
  end if;

  select * into s from public.store_settings limit 1;
  select * into c from public.customers where id = p_customer_id;
  if found and c.loyalty_joined_at is not null then
    v_balance := public.loyalty_balance(c.id);
  end if;

  if not s.loyalty_enabled then
    v_reason := 'disabled';
  elsif not found or c.loyalty_joined_at is null then
    v_reason := 'not_member';
  elsif p_card_token is null or c.card_token is distinct from btrim(p_card_token) then
    v_reason := 'no_proof';
  elsif p_points is null or p_points < s.loyalty_min_redeem_points then
    v_reason := 'below_minimum';
  elsif p_points > v_balance then
    v_reason := 'over_balance';
  end if;

  return jsonb_build_object(
    'ok', v_reason is null,
    'reason', v_reason,
    'balance', v_balance,
    'value_cents', greatest(coalesce(p_points, 0), 0)::bigint * s.loyalty_point_value_cents
  );
end;
$$;
revoke execute on function public.loyalty_check_redeem(uuid, integer, text) from public, anon;
grant execute on function public.loyalty_check_redeem(uuid, integer, text) to authenticated;

-- The public card page. Anyone holding the token (it is the card) sees the
-- first name, the balance and the recent history, and NOTHING else: no phone,
-- no ids, no sale ids. A name that is only a phone number shows no name.
create function public.loyalty_card(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.customers%rowtype;
  s public.store_settings%rowtype;
  v_balance integer;
  v_first text;
  v_history jsonb;
begin
  if p_token is null or btrim(p_token) = '' or char_length(p_token) > 64 then
    return null;
  end if;
  select * into c from public.customers
  where card_token = btrim(p_token) and loyalty_joined_at is not null;
  if not found then
    return null;
  end if;

  select * into s from public.store_settings limit 1;
  v_balance := public.loyalty_balance(c.id);
  v_first := split_part(btrim(c.name), ' ', 1);
  if v_first ~ '^[+0-9.\-]*$' then
    v_first := null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'created_at', h.created_at, 'kind', h.kind, 'points', h.points
         ) order by h.created_at desc, h.id), '[]'::jsonb)
  into v_history
  from (
    select l.id, l.created_at, l.kind, l.points
    from public.loyalty_ledger l
    where l.customer_id = c.id
    order by l.created_at desc, l.id
    limit 10
  ) h;

  return jsonb_build_object(
    'first_name', v_first,
    'balance_points', v_balance,
    'balance_value_cents', greatest(v_balance, 0)::bigint * s.loyalty_point_value_cents,
    'point_value_cents', s.loyalty_point_value_cents,
    -- How points are earned, for the "how it works" line (a visitor cannot
    -- read the store settings).
    'cents_per_point', s.loyalty_cents_per_point,
    'history', v_history
  );
end;
$$;
revoke execute on function public.loyalty_card(text) from public;
grant execute on function public.loyalty_card(text) to anon, authenticated;

-------------------------------------------------------------------------------
-- 7. Owner only: adjust, new card, member details, history, report
-------------------------------------------------------------------------------
create function public.loyalty_adjust(p_customer_id uuid, p_points integer, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(p_note), '');
begin
  if not public.is_owner() then
    raise exception 'Only an owner can adjust points' using errcode = '42501';
  end if;
  if p_points is null or p_points = 0 then
    raise exception 'The adjustment cannot be zero' using errcode = '22023';
  end if;
  if v_note is null or char_length(v_note) > 200 then
    raise exception 'A note of 1 to 200 characters is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.customers where id = p_customer_id and loyalty_joined_at is not null
  ) then
    raise exception 'Not a loyalty member' using errcode = '22023';
  end if;

  insert into public.loyalty_ledger (customer_id, kind, points, created_by, note)
  values (p_customer_id, 'adjust', p_points, auth.uid(), v_note);
  insert into public.activity_log (actor_id, action, entity_id, details)
  values (auth.uid(), 'loyalty_adjust', p_customer_id,
          jsonb_build_object('customer_id', p_customer_id, 'points', p_points, 'note', v_note));

  return public.loyalty_balance(p_customer_id);
end;
$$;
revoke execute on function public.loyalty_adjust(uuid, integer, text) from public, anon;
grant execute on function public.loyalty_adjust(uuid, integer, text) to authenticated;

-- A lost or shared card: a new token, the old QR stops working.
create function public.loyalty_reset_card(p_customer_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := public.loyalty_new_token();
begin
  if not public.is_owner() then
    raise exception 'Only an owner can issue a new card' using errcode = '42501';
  end if;
  update public.customers set card_token = v_token
  where id = p_customer_id and loyalty_joined_at is not null;
  if not found then
    raise exception 'Not a loyalty member' using errcode = '22023';
  end if;
  insert into public.activity_log (actor_id, action, entity_id, details)
  values (auth.uid(), 'loyalty_reset_card', p_customer_id,
          jsonb_build_object('customer_id', p_customer_id));
  return v_token;
end;
$$;
revoke execute on function public.loyalty_reset_card(uuid) from public, anon;
grant execute on function public.loyalty_reset_card(uuid) to authenticated;

-- The owner's view of one member (the table hides the token and the E.164).
create function public.loyalty_member_details(p_customer_id uuid)
returns table (
  customer_id uuid, name text, phone_e164 text, card_token text,
  joined_at timestamptz, balance integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_owner() then
    raise exception 'Only an owner can read member details' using errcode = '42501';
  end if;
  return query
    select c.id, c.name, c.phone_e164, c.card_token, c.loyalty_joined_at,
           public.loyalty_balance(c.id)
    from public.customers c
    where c.id = p_customer_id and c.loyalty_joined_at is not null;
end;
$$;
revoke execute on function public.loyalty_member_details(uuid) from public, anon;
grant execute on function public.loyalty_member_details(uuid) to authenticated;

-- Points balance of every member, for the Clients list (owner).
create function public.loyalty_balances()
returns table (customer_id uuid, balance integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_owner() then
    raise exception 'Only an owner can read balances' using errcode = '42501';
  end if;
  return query
    select c.id, public.loyalty_balance(c.id)
    from public.customers c
    where c.loyalty_joined_at is not null;
end;
$$;
revoke execute on function public.loyalty_balances() from public, anon;
grant execute on function public.loyalty_balances() to authenticated;

-- Dating (as the other reports): sales by occurred_at in [from, to), refunds by
-- the day the return was made, ledger rows by created_at; the redeemed figures
-- come from the sales themselves (what customers actually got as a discount,
-- voided sales left out).
create function public.report_loyalty(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_earned bigint;
  v_adjusted bigint;
  v_bonus bigint;
  v_top_bonus jsonb;
  v_redeemed bigint;
  v_value bigint;
  v_total integer;
  v_new integer;
  v_m_count bigint;
  v_m_cents bigint;
  v_all_cents bigint;
  v_top jsonb;
begin
  if not public.is_owner() then
    raise exception 'Reports are owner only' using errcode = '42501';
  end if;

  select coalesce(sum(points) filter (where kind = 'earn'), 0),
         coalesce(sum(points) filter (where kind in ('sale_adjust', 'adjust')), 0),
         coalesce(sum(bonus_points), 0)
    into v_earned, v_adjusted, v_bonus
  from public.loyalty_ledger
  where created_at >= p_from and created_at < p_to;

  select coalesce(sum(loyalty_points_redeemed), 0), coalesce(sum(loyalty_discount_cents), 0)
    into v_redeemed, v_value
  from public.sales
  where voided_at is null and occurred_at >= p_from and occurred_at < p_to;

  select count(*) into v_total from public.customers where loyalty_joined_at is not null;
  select count(*) into v_new from public.customers
  where loyalty_joined_at >= p_from and loyalty_joined_at < p_to;

  with sale_rows as (
    select s.id, s.total_cents, (c.loyalty_joined_at is not null) as member
    from public.sales s
    left join public.customers c on c.id = s.customer_id
    where s.voided_at is null and s.occurred_at >= p_from and s.occurred_at < p_to
  ),
  refunds as (
    select (c.loyalty_joined_at is not null) as member, sr.refund_cents
    from public.sale_returns sr
    join public.sales s on s.id = sr.sale_id
    left join public.customers c on c.id = s.customer_id
    where sr.created_at >= p_from and sr.created_at < p_to
  )
  select
    (select count(*) from sale_rows where member),
    (select coalesce(sum(total_cents), 0) from sale_rows where member)
      - (select coalesce(sum(refund_cents), 0) from refunds where member),
    (select coalesce(sum(total_cents), 0) from sale_rows)
      - (select coalesce(sum(refund_cents), 0) from refunds)
  into v_m_count, v_m_cents, v_all_cents;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', t.name, 'sales_cents', t.sales_cents, 'points_balance', t.balance
         ) order by t.sales_cents desc, t.name), '[]'::jsonb)
  into v_top
  from (
    select c.name,
           coalesce(sum(s.total_cents) filter (
             where s.voided_at is null and s.occurred_at >= p_from and s.occurred_at < p_to), 0)
           - coalesce((
               select sum(sr.refund_cents)
               from public.sale_returns sr
               join public.sales s2 on s2.id = sr.sale_id
               where s2.customer_id = c.id and sr.created_at >= p_from and sr.created_at < p_to
             ), 0) as sales_cents,
           public.loyalty_balance(c.id) as balance
    from public.customers c
    join public.sales s on s.customer_id = c.id
    where c.loyalty_joined_at is not null
    group by c.id, c.name
    order by 2 desc, c.name
    limit 5
  ) t
  where t.sales_cents > 0;

  -- Bonus awarded per product by the sales that earned in the period (gross of
  -- later returns, voided sales left out).
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_name', b.name, 'bonus_points', b.bonus
         ) order by b.bonus desc, b.name), '[]'::jsonb)
  into v_top_bonus
  from (
    select pr.name, sum(floor(si.quantity)::bigint * si.loyalty_bonus_per_unit) as bonus
    from public.loyalty_ledger l
    join public.sales s on s.id = l.sale_id and s.voided_at is null
    join public.sale_items si on si.sale_id = s.id
    join public.products pr on pr.id = si.product_id
    where l.kind = 'earn' and l.created_at >= p_from and l.created_at < p_to
      and si.loyalty_eligible and si.loyalty_bonus_per_unit > 0
    group by pr.id, pr.name
    having sum(floor(si.quantity)::bigint * si.loyalty_bonus_per_unit) > 0
    order by 2 desc, pr.name
    limit 5
  ) b;

  return jsonb_build_object(
    'points_earned', v_earned,
    'points_bonus', v_bonus,
    'top_bonus_products', v_top_bonus,
    'points_adjusted', v_adjusted,
    'points_redeemed', v_redeemed,
    'value_redeemed_cents', v_value,
    'members_total', v_total,
    'members_new', v_new,
    'member_sales_count', v_m_count,
    'member_sales_cents', v_m_cents,
    'all_sales_cents', v_all_cents,
    'top_members', v_top
  );
end;
$$;
revoke execute on function public.report_loyalty(timestamptz, timestamptz) from public, anon;
grant execute on function public.report_loyalty(timestamptz, timestamptz) to authenticated;

-------------------------------------------------------------------------------
-- 8. Returns and voids: resync what a sale earned and spent
-------------------------------------------------------------------------------
-- What the sale SHOULD net in points now, versus what its ledger rows already
-- add up to; one 'sale_adjust' row for the difference, none when equal, so
-- calling it twice writes nothing the second time.
--   * earned target: floor(eligible paid remaining / rate that applied), where
--     eligible = the lines stamped eligible, remaining = paid minus the refunds
--     of those lines; 0 for a voided sale; 0 when the sale never earned.
--   * redeemed target: points x (sale discount the KEPT units carry / sale
--     discount of the whole sale), rounded down: points come back only for the
--     returned units they paid for, never for an item paid in money
--     (the customer gets the points back, never loses one to rounding); 0 for a
--     voided sale (all points come back).
-- Internal: called by the triggers below, never by a client.
create function public.loyalty_resync_sale(p_sale_id uuid, p_return_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.sales%rowtype;
  v_customer uuid;
  v_earned integer;
  v_redeemed integer;
  v_current integer;
  v_paid_total bigint;
  v_refunded_total bigint;
  v_eligible_remaining bigint;
  v_target_bonus integer := 0;
  v_current_bonus integer;
  v_bonus_remaining bigint;
  v_alloc_total numeric;
  v_alloc_remaining numeric;
  v_target_earn integer := 0;
  v_target_redeem integer := 0;
  v_delta integer;
begin
  select * into s from public.sales where id = p_sale_id for update;
  if not found then
    return 0;
  end if;

  select
    coalesce(sum(points) filter (where kind = 'earn'), 0),
    -coalesce(sum(points) filter (where kind = 'redeem'), 0),
    coalesce(sum(points), 0),
    coalesce(sum(bonus_points), 0),
    (array_agg(customer_id order by (kind = 'earn') desc, created_at))[1]
  into v_earned, v_redeemed, v_current, v_current_bonus, v_customer
  from public.loyalty_ledger
  where sale_id = p_sale_id;

  if v_customer is null then
    return 0;
  end if;

  if s.voided_at is null then
    select coalesce(sum(lp.paid_cents), 0),
           coalesce(sum(coalesce(r.refunded, 0)), 0),
           coalesce(sum(lp.paid_cents - coalesce(r.refunded, 0))
                      filter (where si.loyalty_eligible), 0),
           coalesce(sum(floor(greatest(si.quantity - coalesce(r.returned_qty, 0), 0))::bigint
                        * si.loyalty_bonus_per_unit) filter (where si.loyalty_eligible), 0),
           -- The sale discount each line carries (points are part of it, spread
           -- the same way), in total and for the units still kept.
           coalesce(sum(si.line_total_cents - lp.paid_cents), 0),
           coalesce(sum((si.line_total_cents - lp.paid_cents)
                        * greatest(si.quantity - coalesce(r.returned_qty, 0), 0) / si.quantity), 0)
    into v_paid_total, v_refunded_total, v_eligible_remaining, v_bonus_remaining,
         v_alloc_total, v_alloc_remaining
    from public.loyalty_line_paid(p_sale_id) lp
    join public.sale_items si on si.id = lp.sale_item_id
    left join lateral (
      select sum(ri.refund_cents) as refunded, sum(ri.quantity) as returned_qty
      from public.sale_return_items ri where ri.sale_item_id = lp.sale_item_id
    ) r on true;

    if v_earned > 0 and s.loyalty_cents_per_point is not null then
      v_target_bonus := v_bonus_remaining::integer;
      v_target_earn := floor(v_eligible_remaining::numeric / s.loyalty_cents_per_point)::integer
                       + v_target_bonus;
    end if;

    -- Points come back for what they paid for: the returned units' share of
    -- the sale discount (points included), never for an item paid in money.
    -- Rounded down, so the customer gets the odd point back.
    if v_redeemed > 0 then
      if v_alloc_total > 0 then
        v_target_redeem := floor(v_redeemed::numeric * v_alloc_remaining / v_alloc_total)::integer;
      else
        v_target_redeem := v_redeemed;
      end if;
    end if;
  end if;

  v_delta := (v_target_earn - v_target_redeem) - v_current;
  if v_delta = 0 then
    return 0;
  end if;

  insert into public.loyalty_ledger (customer_id, sale_id, return_id, kind, points, bonus_points, created_by, note)
  values (
    v_customer, p_sale_id, p_return_id, 'sale_adjust', v_delta, v_target_bonus - v_current_bonus, auth.uid(),
    case when s.voided_at is not null then 'void' else 'return' end
  );
  return v_delta;
end;
$$;
revoke execute on function public.loyalty_resync_sale(uuid, uuid) from public, anon, authenticated;

create function public.loyalty_after_return_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select sr.sale_id,
           case when count(distinct sr.id) = 1 then min(sr.id::text)::uuid end as return_id
    from new_rows n
    join public.sale_returns sr on sr.id = n.return_id
    group by sr.sale_id
  loop
    begin
      perform public.loyalty_resync_sale(r.sale_id, r.return_id);
    exception when others then
      raise warning 'loyalty resync skipped for sale %: %', r.sale_id, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;
revoke execute on function public.loyalty_after_return_items() from public, anon, authenticated;

create trigger trg_sale_return_items_loyalty
  after insert on public.sale_return_items
  referencing new table as new_rows
  for each statement execute function public.loyalty_after_return_items();

create function public.loyalty_after_void()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.loyalty_resync_sale(new.id, null);
  exception when others then
    raise warning 'loyalty resync skipped for sale %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.loyalty_after_void() from public, anon, authenticated;

create trigger trg_sales_loyalty_void
  after update of voided_at on public.sales
  for each row
  when (old.voided_at is null and new.voided_at is not null)
  execute function public.loyalty_after_void();

-------------------------------------------------------------------------------
-- 9. record_sale: 046's body plus p_loyalty and the loyalty blocks
-------------------------------------------------------------------------------
-- A new parameter changes the signature, and two overloads would be ambiguous
-- through PostgREST: the 7-argument function is dropped and recreated with the
-- 8th argument defaulted (old queued payloads without p_loyalty still work, and
-- so does recover_sale, which calls it positionally).
-- Only change to existing blocks: the cashier discount limit and the discount
-- review use p_discount_cents minus the points value (points are not a discount
-- the cashier gave).
drop function public.record_sale(
  uuid, uuid, public.payment_method, bigint, jsonb, timestamptz, uuid
);

create function public.record_sale(
  p_sale_id uuid,
  p_customer_id uuid,
  p_payment_method public.payment_method,
  p_discount_cents bigint,
  p_lines jsonb,
  p_occurred_at timestamptz,
  p_expected_cashier uuid default null,
  p_loyalty jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_line jsonb;
  v_lines_total bigint;
  v_needs_review boolean;
  v_line_subtotal bigint;
  v_line_discount bigint;
  v_mismatches jsonb;
  v_pct numeric;
  v_discount_lines jsonb;
  v_sale_discount jsonb;
  v_kind text;
  v_note text;
  v_divers_max bigint;
  -- loyalty (048)
  v_claimed_points integer := 0;
  v_redeem_points integer := 0;
  v_loyalty_discount bigint := 0;
  v_loyalty_bad boolean := false;
  v_found uuid;
  v_member uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles where id = v_actor and role in ('owner', 'cashier')
  ) then
    raise exception 'Authenticated staff required' using errcode = '42501';
  end if;

  -- An ASSERTION, never a claim. The sale is always credited to the caller's own
  -- session (v_actor); this only lets a device say "this was rung up by X" so a
  -- sync that lands on the wrong account (someone signed in meanwhile) is refused
  -- instead of silently recorded under that account (audit C05). Nothing a client
  -- sends can make a sale be credited to anyone but the caller.
  if p_expected_cashier is not null and p_expected_cashier <> v_actor then
    raise exception 'This sale was rung up by another user' using errcode = '42501';
  end if;

  if p_sale_id is null or p_payment_method is null
     or p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A sale needs at least one line' using errcode = '22023';
  end if;

  if p_payment_method = 'credit' and p_customer_id is null then
    raise exception 'A credit sale needs a customer' using errcode = '22023';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) as line
  loop
    v_line_subtotal := round(
      (v_line ->> 'quantity')::numeric * (v_line ->> 'unit_price_cents')::bigint
    );
    v_line_discount := coalesce((v_line ->> 'discount_cents')::bigint, 0);

    if v_line_discount < 0 or v_line_discount > v_line_subtotal then
      raise exception 'A line discount cannot exceed that line''s price';
    end if;

    -- Divers (the built-in free-amount item): one at a time, within the owner's
    -- maximum, with a short note. Checked here as well as on the pad, because an
    -- offline device may hold an older limit or a hand-built payload.
    select kind into v_kind from public.products where id = (v_line ->> 'product_id')::uuid;
    if v_kind = 'misc' then
      select divers_max_cents into v_divers_max from public.store_settings limit 1;
      if (v_line ->> 'quantity')::numeric <> 1 then
        raise exception 'A Divers line is always quantity 1' using errcode = '22023';
      end if;
      if (v_line ->> 'unit_price_cents')::bigint <= 0
         or (v_line ->> 'unit_price_cents')::bigint > coalesce(v_divers_max, 20000) then
        raise exception 'A Divers amount must be above 0 and within the maximum' using errcode = '22023';
      end if;
      if char_length(coalesce(btrim(v_line ->> 'note'), '')) > 60 then
        raise exception 'A Divers note is at most 60 characters' using errcode = '22023';
      end if;
    end if;
  end loop;

  select coalesce(
    sum(
      ((line ->> 'quantity')::numeric * (line ->> 'unit_price_cents')::bigint)::bigint
      - coalesce((line ->> 'discount_cents')::bigint, 0)
    ),
    0
  )
  into v_lines_total
  from jsonb_array_elements(p_lines) as line;

  if p_discount_cents < 0 or p_discount_cents > v_lines_total then
    raise exception 'The sale discount cannot exceed the basket total';
  end if;

  -- Loyalty claim (048): how many points the device says it spent, and what
  -- that is worth. Never allowed to fail the sale: an unreadable or impossible
  -- claim is recorded as 0 points and flagged for the owner.
  begin
    if p_loyalty is not null and jsonb_typeof(p_loyalty) = 'object'
       and nullif(p_loyalty ->> 'redeem_points', '') is not null then
      v_claimed_points := (p_loyalty ->> 'redeem_points')::integer;
      if v_claimed_points < 0 then
        v_claimed_points := 0;
        v_loyalty_bad := true;
      elsif v_claimed_points > 0 then
        v_loyalty_discount := v_claimed_points::bigint
          * coalesce((select loyalty_point_value_cents from public.store_settings limit 1), 10);
        if v_loyalty_discount > p_discount_cents then
          v_loyalty_bad := true;
          v_loyalty_discount := 0;
        else
          v_redeem_points := v_claimed_points;
        end if;
      end if;
    end if;
  exception when others then
    v_claimed_points := 0;
    v_redeem_points := 0;
    v_loyalty_discount := 0;
    v_loyalty_bad := true;
  end;

  v_needs_review := p_occurred_at > now() + interval '24 hours'
    or p_occurred_at < now() - interval '30 days';

  insert into public.sales (
    id, cashier_id, customer_id, payment_method, discount_cents, total_cents,
    occurred_at, needs_clock_review,
    loyalty_points_redeemed, loyalty_discount_cents, needs_loyalty_review
  )
  values (
    p_sale_id,
    v_actor,
    p_customer_id,
    p_payment_method,
    p_discount_cents,
    v_lines_total - p_discount_cents,
    p_occurred_at,
    v_needs_review,
    v_redeem_points,
    v_loyalty_discount,
    v_loyalty_bad
  )
  on conflict (id) do nothing;

  -- Already recorded by an earlier attempt (offline retry): add nothing, log nothing.
  if not found then
    return p_sale_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    -- A note is kept for Divers lines only; the cost of a Divers line is
    -- estimated by the stamp trigger, never taken from the payload.
    select kind into v_kind from public.products where id = (v_line ->> 'product_id')::uuid;
    v_note := case when v_kind = 'misc' then nullif(btrim(v_line ->> 'note'), '') end;
    insert into public.sale_items (sale_id, product_id, quantity, unit_price_cents, discount_cents, note)
    values (
      p_sale_id,
      (v_line ->> 'product_id')::uuid,
      (v_line ->> 'quantity')::numeric,
      (v_line ->> 'unit_price_cents')::bigint,
      coalesce((v_line ->> 'discount_cents')::bigint, 0),
      v_note
    );
  end loop;

  -- Price review. Never allowed to fail the sale: money has already changed
  -- hands, and an offline sale cannot be un-rung. An error in here is turned
  -- into a warning and the sale stays recorded.
  begin
    select jsonb_agg(
             jsonb_build_object(
               'product_id', c.product_id,
               'product_name', pr.name,
               'quantity', c.quantity,
               'device_price_cents', c.device_price,
               'expected_price_cents', c.expected,
               'matches_previous_price', c.previous is not null and c.device_price = c.previous
             )
             order by c.ord
           )
      into v_mismatches
    from (
      select
        l.ord,
        l.product_id,
        l.quantity,
        l.device_price,
        sp.effective_cents as expected,
        sp.previous_cents as previous
      from (
        select ord,
               (line ->> 'product_id')::uuid as product_id,
               (line ->> 'quantity')::numeric as quantity,
               (line ->> 'unit_price_cents')::bigint as device_price
        from jsonb_array_elements(p_lines) with ordinality as t(line, ord)
      ) l
      cross join lateral public.selling_price_at(l.product_id, p_occurred_at) sp
    ) c
    join public.products pr on pr.id = c.product_id
    -- Divers has no list price to be wrong about.
    where pr.kind <> 'misc'
      and c.expected is not null and c.device_price is distinct from c.expected;

    if v_mismatches is not null then
      update public.sales set needs_price_review = true where id = p_sale_id;
      insert into public.activity_log (actor_id, action, entity_id, details)
      values (
        v_actor,
        'price_mismatch',
        p_sale_id,
        jsonb_build_object(
          'sale_id', p_sale_id,
          'occurred_at', p_occurred_at,
          'lines', v_mismatches
        )
      );
    end if;
  exception when others then
    raise warning 'price review skipped for sale %: %', p_sale_id, sqlerrm;
  end;

  -- Discount review: same rules, own block, so neither check can skip the
  -- other and neither can fail the sale. "Exceeds" is strict: a discount of
  -- exactly the threshold is fine. Comparisons stay in integers/numerics.
  begin
    select discount_review_percent into v_pct from public.owner_settings where singleton;
    v_pct := coalesce(v_pct, 10);

    select jsonb_agg(
             jsonb_build_object(
               'product_id', l.product_id,
               'product_name', pr.name,
               'line_amount_cents', l.amount,
               'discount_cents', l.discount,
               'percent', round(l.discount * 100.0 / l.amount, 2)
             )
             order by l.ord
           )
      into v_discount_lines
    from (
      select ord,
             (line ->> 'product_id')::uuid as product_id,
             round((line ->> 'quantity')::numeric * (line ->> 'unit_price_cents')::bigint)::bigint as amount,
             coalesce((line ->> 'discount_cents')::bigint, 0) as discount
      from jsonb_array_elements(p_lines) with ordinality as t(line, ord)
    ) l
    join public.products pr on pr.id = l.product_id
    where l.amount > 0 and l.discount * 100 > v_pct * l.amount;

    -- Loyalty points (048) are not a discount the cashier gave: left out here.
    if p_discount_cents - v_loyalty_discount > 0 and v_lines_total > 0
       and (p_discount_cents - v_loyalty_discount) * 100 > v_pct * v_lines_total then
      v_sale_discount := jsonb_build_object(
        'discount_cents', p_discount_cents - v_loyalty_discount,
        'basket_cents', v_lines_total,
        'percent', round((p_discount_cents - v_loyalty_discount) * 100.0 / v_lines_total, 2)
      );
    end if;

    if v_discount_lines is not null or v_sale_discount is not null then
      update public.sales set needs_discount_review = true where id = p_sale_id;
      insert into public.activity_log (actor_id, action, entity_id, details)
      values (
        v_actor,
        'discount_over_threshold',
        p_sale_id,
        jsonb_build_object(
          'sale_id', p_sale_id,
          'occurred_at', p_occurred_at,
          'threshold_percent', v_pct,
          'lines', coalesce(v_discount_lines, '[]'::jsonb),
          'sale_discount', v_sale_discount
        )
      );
    end if;
  exception when others then
    raise warning 'discount review skipped for sale %: %', p_sale_id, sqlerrm;
  end;

  -- Cashier discount limit (migration 041). A third review, own block, never
  -- allowed to fail the sale: the DEVICE enforces the limit, the server only
  -- flags a breach for the owner. Skipped for the owner, who has no limit.
  -- Works on the stamped sale_items (discountable is set by the insert trigger,
  -- never by the payload).
  declare
    v_percent numeric;
    v_max bigint;
    v_gross bigint;
    v_limit bigint;
    v_total_discount bigint;
    v_blocked jsonb;
  begin
    if not exists (select 1 from public.profiles where id = v_actor and role = 'owner') then
      select cashier_discount_percent, cashier_discount_max_cents
        into v_percent, v_max
      from public.store_settings limit 1;
      v_percent := coalesce(v_percent, 5);
      v_max := coalesce(v_max, 2000);

      select coalesce(sum(round(quantity * unit_price_cents)::bigint) filter (where discountable), 0),
             coalesce(sum(discount_cents), 0)
        into v_gross, v_total_discount
      from public.sale_items
      where sale_id = p_sale_id;

      -- Loyalty points (048) are not a cashier discount.
      v_total_discount := v_total_discount + (p_discount_cents - v_loyalty_discount);
      v_limit := least(floor(v_percent * v_gross / 100)::bigint, v_max);

      select jsonb_agg(
               jsonb_build_object('product_id', product_id, 'discount_cents', discount_cents)
               order by created_at, id
             )
        into v_blocked
      from public.sale_items
      where sale_id = p_sale_id and not discountable and discount_cents > 0;

      if v_total_discount > v_limit or v_blocked is not null then
        update public.sales set needs_discount_review = true where id = p_sale_id;
        insert into public.activity_log (actor_id, action, entity_id, details)
        values (
          v_actor,
          'discount_over_cashier_limit',
          p_sale_id,
          jsonb_build_object(
            'sale_id', p_sale_id,
            'occurred_at', p_occurred_at,
            'limit_cents', v_limit,
            'total_discount_cents', v_total_discount,
            'percent', v_percent,
            'max_cents', v_max,
            'blocked_lines', coalesce(v_blocked, '[]'::jsonb)
          )
        );
      end if;
    end if;
  exception when others then
    raise warning 'cashier discount review skipped for sale %: %', p_sale_id, sqlerrm;
  end;

  -- Customer debt limit (migration 043). A fourth review, own block, never
  -- allowed to fail the sale: the DEVICE enforces the limit, the server only
  -- flags a breach for the owner. Skipped for the owner, who has no limit and
  -- for anything but a credit sale. An idempotent replay never gets here (it
  -- returned above), so a sale is judged once.
  --
  -- The balance BEFORE this sale is the customer_balances definition (credit
  -- sales not voided, minus payments) with this sale's own row left out: it was
  -- inserted a moment ago, so it must not count against itself.
  declare
    v_limit bigint;
    v_credit bigint;
    v_paid bigint;
    v_credit_refunds bigint;
    v_balance_before bigint;
    v_sale_total bigint := v_lines_total - p_discount_cents;
    v_customer_name text;
  begin
    if p_payment_method = 'credit' and p_customer_id is not null
       and not exists (select 1 from public.profiles where id = v_actor and role = 'owner') then
      v_limit := public.customer_credit_limit(p_customer_id);

      select coalesce(sum(total_cents), 0) into v_credit
      from public.sales
      where customer_id = p_customer_id
        and payment_method = 'credit'
        and voided_at is null
        and id <> p_sale_id;

      select coalesce(sum(amount_cents), 0) into v_paid
      from public.customer_payments
      where customer_id = p_customer_id;

      -- Credit refunds (migration 046) lower what the customer owes, exactly as
      -- in customer_balances.
      select coalesce(sum(r.refund_cents), 0) into v_credit_refunds
      from public.sale_returns r
      join public.sales s on s.id = r.sale_id
      where s.customer_id = p_customer_id
        and r.refund_method = 'credit';

      v_balance_before := v_credit - v_paid - v_credit_refunds;

      if v_balance_before + v_sale_total > v_limit then
        select name into v_customer_name from public.customers where id = p_customer_id;
        update public.sales set needs_credit_review = true where id = p_sale_id;
        insert into public.activity_log (actor_id, action, entity_id, details)
        values (
          v_actor,
          'credit_over_customer_limit',
          p_sale_id,
          jsonb_build_object(
            'sale_id', p_sale_id,
            'occurred_at', p_occurred_at,
            'customer_id', p_customer_id,
            'customer_name', v_customer_name,
            'limit_cents', v_limit,
            'balance_before_cents', v_balance_before,
            'sale_total_cents', v_sale_total
          )
        );
      end if;
    end if;
  exception when others then
    raise warning 'customer credit review skipped for sale %: %', p_sale_id, sqlerrm;
  end;

  -- Loyalty (migration 048). Each block is its own begin/exception and can
  -- never fail the sale. An idempotent replay returned above, so a sale is
  -- judged, credited and charged once.

  -- 1. Who is the member? A customer id or an (offline-style) phone.
  begin
    if p_loyalty is not null and jsonb_typeof(p_loyalty) = 'object' then
      declare
        v_cid uuid := nullif(p_loyalty ->> 'customer_id', '')::uuid;
        v_phone text := public.normalize_ma_phone(p_loyalty ->> 'phone');
        v_resolved uuid;
      begin
        if v_cid is not null then
          select id into v_resolved from public.customers
          where id = v_cid and loyalty_joined_at is not null;
        end if;
        if v_resolved is null and v_phone is not null then
          select id into v_resolved from public.customers
          where phone_e164 = v_phone and loyalty_joined_at is not null;
        end if;

        if v_resolved is not null then
          if p_customer_id is null then
            update public.sales set customer_id = v_resolved where id = p_sale_id;
            v_member := v_resolved;
          elsif p_customer_id = v_resolved then
            v_member := v_resolved;
          else
            -- A different customer pays this sale: keep them, award nothing.
            update public.sales set needs_loyalty_review = true where id = p_sale_id;
            insert into public.activity_log (actor_id, action, entity_id, details)
            values (
              v_actor, 'loyalty_member_mismatch', p_sale_id,
              jsonb_build_object(
                'sale_id', p_sale_id,
                'sale_customer_id', p_customer_id,
                'member_id', v_resolved
              )
            );
          end if;
          v_found := v_resolved;
        end if;
      end;
    end if;
  exception when others then
    raise warning 'loyalty member lookup skipped for sale %: %', p_sale_id, sqlerrm;
  end;

  -- 2. Spending points: the customer already got the discount at the counter,
  -- so the points are taken as claimed; anything the server cannot confirm
  -- flags the sale.
  begin
    if v_claimed_points > 0 or v_loyalty_bad then
      declare
        st public.store_settings%rowtype;
        c public.customers%rowtype;
        v_reason text;
        v_eligible bigint;
      begin
        select * into st from public.store_settings limit 1;

        -- Points pay only for items that earn points (never Divers or an
        -- excluded product, judged by the stamp of the sale) AND that take a
        -- sale discount: points are part of discount_cents, which
        -- sale_line_economics spreads over the discountable lines (or every
        -- line when none is). Never more than those lines have left once the
        -- manual part of the discount is spread, or a line's share would go
        -- negative and a return would refund money paid with points.
        select least(
                 coalesce(sum(b.line_total_cents) filter (where b.loyalty_eligible), 0),
                 coalesce(sum(b.line_total_cents), 0) - (p_discount_cents - v_loyalty_discount)
               )
          into v_eligible
        from (
          select si.line_total_cents, si.loyalty_eligible,
                 si.discountable or not bool_or(si.discountable) over () as in_base
          from public.sale_items si
          where si.sale_id = p_sale_id
        ) b
        where b.in_base;

        if v_claimed_points < 0 or (v_claimed_points = 0 and v_loyalty_bad)
           or (v_claimed_points > 0 and v_redeem_points = 0) then
          v_reason := 'discount_below_value';
        elsif not st.loyalty_enabled then
          v_reason := 'disabled';
        elsif v_found is null then
          v_reason := 'not_member';
        else
          select * into c from public.customers where id = v_found for update;
          if c.card_token is distinct from nullif(btrim(p_loyalty ->> 'card_token'), '') then
            v_reason := 'no_proof';
          elsif v_redeem_points < st.loyalty_min_redeem_points then
            v_reason := 'below_minimum';
          elsif v_redeem_points > public.loyalty_balance(v_found) then
            v_reason := 'over_balance';
          elsif v_loyalty_discount > v_eligible then
            v_reason := 'over_eligible';
          end if;
        end if;

        if v_redeem_points > 0 and v_found is not null then
          insert into public.loyalty_ledger (customer_id, sale_id, kind, points, created_by)
          values (v_found, p_sale_id, 'redeem', -v_redeem_points, v_actor);
        end if;

        if v_reason is not null then
          update public.sales set needs_loyalty_review = true where id = p_sale_id;
          insert into public.activity_log (actor_id, action, entity_id, details)
          values (
            v_actor, 'loyalty_redeem_unconfirmed', p_sale_id,
            jsonb_build_object(
              'sale_id', p_sale_id,
              'occurred_at', p_occurred_at,
              'reason', v_reason,
              'claimed_points', coalesce(
                nullif(p_loyalty ->> 'redeem_points', ''), '0'),
              'recorded_points', v_redeem_points,
              'discount_cents', p_discount_cents,
              'customer_id', v_found
            )
          );
        end if;
      end;
    end if;
  exception when others then
    raise warning 'loyalty redeem skipped for sale %: %', p_sale_id, sqlerrm;
  end;

  -- 3. Earning: floor(eligible paid / cents per point). Eligible = not Divers,
  -- product and category (and its parent) not excluded; paid = the line total
  -- after its own discount and its share of the sale discount, points included
  -- (so spending points never earns points back).
  begin
    if v_member is not null then
      declare
        st public.store_settings%rowtype;
        v_paid bigint;
        v_bonus bigint;
        v_points integer;
        v_today integer;
      begin
        select * into st from public.store_settings limit 1;
        if st.loyalty_enabled then
          -- Only the values stamped on the lines when they were inserted.
          select coalesce(sum(lp.paid_cents) filter (where si.loyalty_eligible), 0),
                 coalesce(sum(floor(si.quantity)::bigint * si.loyalty_bonus_per_unit)
                            filter (where si.loyalty_eligible), 0)
            into v_paid, v_bonus
          from public.loyalty_line_paid(p_sale_id) lp
          join public.sale_items si on si.id = lp.sale_item_id;

          v_points := floor(v_paid::numeric / st.loyalty_cents_per_point)::integer + v_bonus::integer;
          if v_points > 0 then
            insert into public.loyalty_ledger (customer_id, sale_id, kind, points, bonus_points, created_by)
            values (v_member, p_sale_id, 'earn', v_points, v_bonus::integer, v_actor);
            update public.sales set loyalty_cents_per_point = st.loyalty_cents_per_point
            where id = p_sale_id;

            -- 4. Daily review: one customer earning a lot in one store day.
            select coalesce(sum(l.points), 0) into v_today
            from public.loyalty_ledger l
            where l.customer_id = v_member and l.kind = 'earn'
              and public.store_day(l.created_at) = public.store_day(now());
            if v_today > st.loyalty_daily_review_points then
              update public.sales set needs_loyalty_review = true where id = p_sale_id;
              insert into public.activity_log (actor_id, action, entity_id, details)
              values (
                v_actor, 'loyalty_over_daily', p_sale_id,
                jsonb_build_object(
                  'sale_id', p_sale_id,
                  'customer_id', v_member,
                  'points_today', v_today,
                  'threshold_points', st.loyalty_daily_review_points
                )
              );
            end if;
          end if;
        end if;
      end;
    end if;
  exception when others then
    raise warning 'loyalty earn skipped for sale %: %', p_sale_id, sqlerrm;
  end;

  return p_sale_id;
end;
$$;

revoke execute on function public.record_sale(
  uuid, uuid, public.payment_method, bigint, jsonb, timestamptz, uuid, jsonb
) from public, anon;
grant execute on function public.record_sale(
  uuid, uuid, public.payment_method, bigint, jsonb, timestamptz, uuid, jsonb
) to authenticated;
