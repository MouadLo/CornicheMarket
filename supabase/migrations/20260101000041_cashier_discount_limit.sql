-- Cashier discount limit and automatic no-discount products (database half).
--
-- A cashier may give at most cashier_discount_percent of the sale, computed only
-- on items that allow a discount, and never more than cashier_discount_max_cents
-- per sale (line discounts and the sale discount count together). The owner has
-- no limit. A product allows a discount when its margin is at least that percent,
-- unless the owner overrides it ('allow' / 'block').
--
-- The DEVICE enforces the limit. The server never rejects a sale for it (an
-- offline sale must sync): record_sale only FLAGS a breach for owner review
-- (sales.needs_discount_review + activity_log 'discount_over_cashier_limit').
--
-- Note: the built-in free-amount item is products.kind = 'misc' (the app calls it
-- Divers). Its price is 0 on the product row and its cost is estimated, so it is
-- decided by owner_settings.divers_margin_percent BEFORE the price check.

-------------------------------------------------------------------------------
-- 1. Settings and the per-product override
-------------------------------------------------------------------------------
alter table public.store_settings
  add column cashier_discount_percent numeric(5,2) not null default 5
    check (cashier_discount_percent between 0 and 100),
  add column cashier_discount_max_cents bigint not null default 2000
    check (cashier_discount_max_cents >= 0);
-- The existing owner-only update policy keeps cashiers out.
grant update (cashier_discount_percent, cashier_discount_max_cents)
  on public.store_settings to authenticated;

alter table public.products
  add column discount_override text check (discount_override in ('allow', 'block'));
-- Owner only: products has no cashier insert/update policy (RLS), these are the
-- column grants the owner's edits go through.
grant insert (discount_override) on public.products to authenticated;
grant update (discount_override) on public.products to authenticated;

-------------------------------------------------------------------------------
-- 2. discountable(product): usable as a PostgREST computed column
-------------------------------------------------------------------------------
create function public.discountable(p public.products)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_percent numeric;
  v_divers_margin numeric;
begin
  if p.discount_override = 'allow' then return true; end if;
  if p.discount_override = 'block' then return false; end if;

  select cashier_discount_percent into v_percent from public.store_settings limit 1;
  v_percent := coalesce(v_percent, 5);

  if p.kind = 'misc' then
    select divers_margin_percent into v_divers_margin from public.owner_settings where singleton;
    return coalesce(v_divers_margin, 20) >= v_percent;
  end if;

  if p.selling_price_cents <= 0 then return false; end if;
  if p.current_cost_cents is null or p.current_cost_cents <= 0 then return false; end if;

  return (p.selling_price_cents - p.current_cost_cents) * 100 >= v_percent * p.selling_price_cents;
end;
$$;

revoke execute on function public.discountable(public.products) from public, anon;
grant execute on function public.discountable(public.products) to authenticated;

-- Cashiers read products only through this view: it carries the boolean, never
-- the cost or the override. create or replace view can only append columns.
create or replace view public.products_cashier_view as
select
  id, name, barcode, category_id, unit,
  selling_price_cents, stock_quantity, low_stock_threshold, active,
  created_at, updated_at, is_low_stock,
  kind, track_stock,
  public.discountable(products) as discountable
from public.products;

-------------------------------------------------------------------------------
-- 3. sale_items.discountable, stamped server-side
-------------------------------------------------------------------------------
alter table public.sale_items
  add column discountable boolean not null default true;

-- Same as 032, plus the stamp. The client never sets it: whatever it sends is
-- overwritten.
create or replace function public.stamp_sale_item_cost()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_prod public.products;
  v_margin numeric;
begin
  select * into v_prod from public.products where id = new.product_id;

  if v_prod.kind = 'misc' then
    -- No purchase cost exists: estimate it from the owner's margin, and say so.
    select divers_margin_percent into v_margin from owner_settings where singleton;
    new.unit_cost_cents := round(new.unit_price_cents * (1 - coalesce(v_margin, 20) / 100.0));
    new.cost_estimated := true;
    new.oversold := false;
  else
    new.unit_cost_cents := v_prod.current_cost_cents;
    new.cost_estimated := false;
    new.oversold := v_prod.stock_quantity < new.quantity;
  end if;

  new.discountable := coalesce(public.discountable(v_prod), true);
  new.line_total_cents := (new.quantity * new.unit_price_cents)::bigint - new.discount_cents;
  return new;
end;
$$;

-------------------------------------------------------------------------------
-- 4. Reports: a sale-level discount is spread only over discountable lines
-------------------------------------------------------------------------------
-- Same largest-remainder method and column list as 018. If a sale has no
-- discountable line (only the owner can do that), every line shares it, as before.
create or replace view sale_line_economics as
with lines as (
  select
    si.id,
    si.sale_id,
    si.product_id,
    si.quantity,
    si.line_total_cents,
    si.unit_cost_cents,
    s.created_at,
    s.occurred_at,
    s.discount_cents as sale_discount_cents,
    (si.discountable or not bool_or(si.discountable) over (partition by si.sale_id)) as eligible
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.voided_at is null
),
weighted as (
  select
    *,
    case when eligible then line_total_cents else 0 end as weight,
    sum(case when eligible then line_total_cents else 0 end) over (partition by sale_id) as sale_lines_total
  from lines
),
exact as (
  select
    *,
    case
      when sale_lines_total > 0
        then sale_discount_cents * weight::numeric / sale_lines_total
      else 0
    end as exact_discount
  from weighted
),
floored as (
  select
    *,
    floor(exact_discount)::bigint as floor_discount,
    exact_discount - floor(exact_discount) as remainder
  from exact
),
ranked as (
  select
    *,
    case when sale_lines_total > 0
      then sale_discount_cents - sum(floor_discount) over (partition by sale_id)
      else 0
    end as leftover,
    row_number() over (partition by sale_id order by remainder desc, id) as remainder_rank
  from floored
)
select
  id,
  sale_id,
  product_id,
  created_at,
  quantity,
  line_total_cents,
  (floor_discount + case when remainder_rank <= leftover then 1 else 0 end)::bigint
    as allocated_discount_cents,
  (line_total_cents
    - (floor_discount + case when remainder_rank <= leftover then 1 else 0 end)
  )::bigint as net_revenue_cents,
  round(unit_cost_cents * quantity)::bigint as cost_cents,
  occurred_at
from ranked
where public.is_owner();

grant select on sale_line_economics to authenticated;

-------------------------------------------------------------------------------
-- 5. record_sale: same as 032, plus the cashier limit review
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

  return p_sale_id;
end;
$$;
