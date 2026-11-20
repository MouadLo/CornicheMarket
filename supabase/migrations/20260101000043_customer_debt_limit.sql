-- Customer debt limit (database half).
--
-- A cashier may not put a credit sale on a customer if it would take what that
-- customer owes above their limit. The limit is a store default
-- (store_settings.customer_credit_limit_cents, 300 DH out of the box) that the
-- owner can override per customer (customers.credit_limit_cents: null = use the
-- store default, 0 = no credit, any other value = that customer's own limit).
-- The owner has no limit.
--
-- Modelled on the cashier discount limit (migration 041): the DEVICE enforces
-- the limit (it must work offline), and the server never rejects a sale for it.
-- record_sale only FLAGS a breach for owner review
-- (sales.needs_credit_review + activity_log 'credit_over_customer_limit').

-------------------------------------------------------------------------------
-- 1. The store default (same grants/policies as the discount limit settings)
-------------------------------------------------------------------------------
alter table public.store_settings
  add column customer_credit_limit_cents bigint not null default 30000
    check (customer_credit_limit_cents >= 0);
-- Every signed-in user already reads store_settings (a cashier's device needs
-- the default to enforce it) and the existing owner-only update policy keeps
-- cashiers out of changing it.
grant update (customer_credit_limit_cents) on public.store_settings to authenticated;

-------------------------------------------------------------------------------
-- 2. The per-customer exception, owner only
-------------------------------------------------------------------------------
alter table public.customers
  add column credit_limit_cents bigint check (credit_limit_cents >= 0);

-- Why a trigger and not a column grant: customers are inserted directly by a
-- cashier (Pay Later creates a customer: policy "staff add customers") and
-- updated only by the owner (policy "owner updates customers"), but both are
-- the same database role, `authenticated`, so a column grant cannot tell them
-- apart. The trigger refuses any signed-in non-owner who sets the column on
-- insert or changes it on update. Calls with no signed-in user (migrations,
-- seed, the service role) are not restricted.
create function public.guard_customer_credit_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_owner() then
    if tg_op = 'INSERT' and new.credit_limit_cents is not null then
      raise exception 'Only the owner can set a customer credit limit' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.credit_limit_cents is distinct from old.credit_limit_cents then
      raise exception 'Only the owner can set a customer credit limit' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_customers_guard_credit_limit
  before insert or update on public.customers
  for each row execute function public.guard_customer_credit_limit();

revoke execute on function public.guard_customer_credit_limit() from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 3. The effective limit
-------------------------------------------------------------------------------
create function public.customer_credit_limit(p_customer_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.credit_limit_cents from public.customers c where c.id = p_customer_id),
    (select s.customer_credit_limit_cents from public.store_settings s limit 1),
    30000
  );
$$;

revoke execute on function public.customer_credit_limit(uuid) from public, anon;
grant execute on function public.customer_credit_limit(uuid) to authenticated;

-------------------------------------------------------------------------------
-- 4. customer_balances: append the limit and the room left
-------------------------------------------------------------------------------
-- Same body as 012; create or replace view can only append columns.
--   credit_limit_cents          the effective limit (own limit, else the store's)
--   credit_available_cents      what the customer may still take on credit (never below 0)
--   credit_limit_override_cents the customer's own limit, null when the store default applies
create or replace view public.customer_balances as
select
  c.id,
  c.name,
  c.phone,
  coalesce(credit.total, 0)::bigint as credit_total_cents,
  coalesce(paid.total, 0)::bigint as paid_total_cents,
  (coalesce(credit.total, 0) - coalesce(paid.total, 0))::bigint as balance_cents,
  public.customer_credit_limit(c.id) as credit_limit_cents,
  greatest(
    public.customer_credit_limit(c.id) - (coalesce(credit.total, 0) - coalesce(paid.total, 0)),
    0
  )::bigint as credit_available_cents,
  c.credit_limit_cents as credit_limit_override_cents
from public.customers c
left join (
  select customer_id, sum(total_cents) as total
  from public.sales
  where payment_method = 'credit' and voided_at is null and customer_id is not null
  group by customer_id
) credit on credit.customer_id = c.id
left join (
  select customer_id, sum(amount_cents) as total
  from public.customer_payments
  group by customer_id
) paid on paid.customer_id = c.id;

-------------------------------------------------------------------------------
-- 5. The review flag and its dismissal
-------------------------------------------------------------------------------
alter table public.sales
  add column needs_credit_review boolean not null default false;

create function public.dismiss_credit_review(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can review credit sales' using errcode = '42501';
  end if;

  update public.sales set needs_credit_review = false
  where id = p_sale_id and needs_credit_review;

  if found then
    insert into public.activity_log (actor_id, action, entity_id, details)
    values (auth.uid(), 'credit_review_dismissed', p_sale_id, jsonb_build_object('sale_id', p_sale_id));
  end if;
end;
$$;

revoke execute on function public.dismiss_credit_review(uuid) from public, anon;
grant execute on function public.dismiss_credit_review(uuid) to authenticated;

-------------------------------------------------------------------------------
-- 6. record_sale: same as 041, plus the customer debt limit review
-------------------------------------------------------------------------------
create or replace function public.record_sale(
  p_sale_id uuid,
  p_customer_id uuid,
  p_payment_method public.payment_method,
  p_discount_cents bigint,
  p_lines jsonb,
  p_occurred_at timestamptz,
  p_expected_cashier uuid default null
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

  v_needs_review := p_occurred_at > now() + interval '24 hours'
    or p_occurred_at < now() - interval '30 days';

  insert into public.sales (
    id, cashier_id, customer_id, payment_method, discount_cents, total_cents,
    occurred_at, needs_clock_review
  )
  values (
    p_sale_id,
    v_actor,
    p_customer_id,
    p_payment_method,
    p_discount_cents,
    v_lines_total - p_discount_cents,
    p_occurred_at,
    v_needs_review
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

    if p_discount_cents > 0 and v_lines_total > 0
       and p_discount_cents * 100 > v_pct * v_lines_total then
      v_sale_discount := jsonb_build_object(
        'discount_cents', p_discount_cents,
        'basket_cents', v_lines_total,
        'percent', round(p_discount_cents * 100.0 / v_lines_total, 2)
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

      v_total_discount := v_total_discount + p_discount_cents;
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

      v_balance_before := v_credit - v_paid;

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

  return p_sale_id;
end;
$$;
