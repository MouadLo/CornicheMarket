-- Device prices (audit C06, pricing point).
--
-- record_sale accepts the unit price the device sends: an offline tablet sells
-- at the prices it cached, and an already-rung sale can never be refused. What
-- was missing is any trace when that price differs from the product's real
-- selling price. This migration makes record_sale compare each line's price
-- with the selling price EFFECTIVE AT occurred_at, and when one differs:
--   * the sale is still recorded, exactly as sent (never rejected),
--   * sales.needs_price_review is set, and
--   * an owner-only activity_log row lists the lines (device price, expected
--     price, and whether the device price equals the PREVIOUS price, which
--     tells a stale offline cache apart from a typo or tampering).
--
-- Discounts are not part of the price comparison: a line's discount_cents and
-- the sale discount are separate, already-validated fields, so a discounted
-- line at the right unit price is not a price mismatch. They get their own,
-- equally non-blocking review: a line discount above X % of that line's amount,
-- or a sale discount above X % of the basket (after line discounts), sets
-- sales.needs_discount_review and logs a discount_over_threshold row. X is the
-- owner's setting (default 10) in owner_settings, which cashiers cannot read.
--
-- Needs two things that did not exist: a selling-price history (the old price
-- was overwritten in place) and an activity log. activity_log has exactly the
-- shape planned in docs/SELL-GRID-DESIGN.md 2.5, so the grid migration should
-- not create it again.

-------------------------------------------------------------------------------
-- 1. Selling-price history, written by a trigger only.
-------------------------------------------------------------------------------
create table public.selling_price_history (
  seq          bigint generated always as identity primary key,
  product_id   uuid not null references public.products (id) on delete cascade,
  price_cents  bigint not null check (price_cents >= 0),
  effective_at timestamptz not null default now()
);
create index idx_selling_price_history_lookup
  on public.selling_price_history (product_id, effective_at desc, seq desc);

-- Backfill: the current price, effective since the product was created.
-- Earlier prices were never recorded, so a sale from before today's price was
-- set can only be compared with today's price.
insert into public.selling_price_history (product_id, price_cents, effective_at)
select id, selling_price_cents, created_at from public.products;

create function public.log_selling_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.selling_price_history (product_id, price_cents, effective_at)
    values (new.id, new.selling_price_cents, new.created_at);
  elsif new.selling_price_cents is distinct from old.selling_price_cents then
    insert into public.selling_price_history (product_id, price_cents, effective_at)
    values (new.id, new.selling_price_cents, now());
  end if;
  return new;
end;
$$;

create trigger trg_products_log_selling_price
  after insert or update of selling_price_cents on public.products
  for each row execute function public.log_selling_price();

-- The price in force at p_at, and the one before it. A moment before the very
-- first record uses the first price.
create function public.selling_price_at(
  p_product uuid,
  p_at timestamptz,
  out effective_cents bigint,
  out previous_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select price_cents,
           row_number() over (order by effective_at desc, seq desc) as rn
    from public.selling_price_history
    where product_id = p_product and effective_at <= p_at
  )
  select
    coalesce(
      (select price_cents from ranked where rn = 1),
      (select price_cents from public.selling_price_history
        where product_id = p_product order by effective_at asc, seq asc limit 1)
    ),
    (select price_cents from ranked where rn = 2)
$$;

-------------------------------------------------------------------------------
-- 2. Activity log: append-only, written only by trusted functions.
-------------------------------------------------------------------------------
create table public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id    uuid not null references public.profiles (id),
  action      text not null,
  entity_id   uuid,
  details     jsonb not null default '{}'
);
create index idx_activity_log_entity on public.activity_log (entity_id);
create index idx_activity_log_action on public.activity_log (action, occurred_at desc);

alter table public.sales
  add column needs_price_review boolean not null default false,
  add column needs_discount_review boolean not null default false;

-- Owner-only settings singleton (same shape as planned in SELL-GRID-DESIGN 2.5;
-- the grid migration adds its own columns to this table instead of creating
-- it). Not store_settings: that table is readable by every signed-in user.
create table public.owner_settings (
  singleton               boolean primary key default true check (singleton),
  discount_review_percent numeric(5,2) not null default 10
    check (discount_review_percent between 0 and 100)
);
insert into public.owner_settings (singleton) values (true);

-------------------------------------------------------------------------------
-- 3. record_sale: same behaviour as 026, plus the price check. The check runs
--    in its own block so that nothing in it can ever make a sale fail.
-------------------------------------------------------------------------------
create or replace function public.record_sale(
  p_sale_id uuid,
  p_customer_id uuid,
  p_payment_method public.payment_method,
  p_discount_cents bigint,
  p_lines jsonb,
  p_occurred_at timestamptz
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
begin
  if v_actor is null or not exists (
    select 1 from public.profiles where id = v_actor and role in ('owner', 'cashier')
  ) then
    raise exception 'Authenticated staff required' using errcode = '42501';
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
    insert into public.sale_items (sale_id, product_id, quantity, unit_price_cents, discount_cents)
    values (
      p_sale_id,
      (v_line ->> 'product_id')::uuid,
      (v_line ->> 'quantity')::numeric,
      (v_line ->> 'unit_price_cents')::bigint,
      coalesce((v_line ->> 'discount_cents')::bigint, 0)
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
    where c.expected is not null and c.device_price is distinct from c.expected;

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

  return p_sale_id;
end;
$$;

-------------------------------------------------------------------------------
-- 4. The owner clears a review once looked at.
-------------------------------------------------------------------------------
create function public.dismiss_price_review(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can review prices' using errcode = '42501';
  end if;

  update public.sales set needs_price_review = false
  where id = p_sale_id and needs_price_review;

  -- Nothing was pending (already dismissed, or never flagged): nothing to log.
  if found then
    insert into public.activity_log (actor_id, action, entity_id, details)
    values (auth.uid(), 'price_review_dismissed', p_sale_id, jsonb_build_object('sale_id', p_sale_id));
  end if;
end;
$$;

create function public.dismiss_discount_review(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can review discounts' using errcode = '42501';
  end if;

  update public.sales set needs_discount_review = false
  where id = p_sale_id and needs_discount_review;

  if found then
    insert into public.activity_log (actor_id, action, entity_id, details)
    values (auth.uid(), 'discount_review_dismissed', p_sale_id, jsonb_build_object('sale_id', p_sale_id));
  end if;
end;
$$;

-------------------------------------------------------------------------------
-- 5. Privileges (the pattern of migration 026: nothing for anon; clients read
--    through RLS only; every write goes through a trusted function).
-------------------------------------------------------------------------------
alter table public.selling_price_history enable row level security;
alter table public.activity_log enable row level security;
alter table public.owner_settings enable row level security;

create policy "owner reads price history" on public.selling_price_history
  for select using (public.is_owner());
create policy "owner reads activity log" on public.activity_log
  for select using (public.is_owner());
create policy "owner reads owner settings" on public.owner_settings
  for select using (public.is_owner());
create policy "owner updates owner settings" on public.owner_settings
  for update using (public.is_owner()) with check (public.is_owner());

revoke all on public.selling_price_history, public.activity_log, public.owner_settings
  from anon, authenticated;
grant select on public.selling_price_history, public.activity_log to authenticated;
-- The owner edits the setting directly (it is configuration, not money); there
-- is no insert or delete: the singleton row always exists.
grant select on public.owner_settings to authenticated;
grant update (discount_review_percent) on public.owner_settings to authenticated;

-- Trigger and helper functions are not callable by clients.
revoke execute on function
  public.log_selling_price(),
  public.selling_price_at(uuid, timestamptz)
from public, anon, authenticated;

revoke execute on function public.dismiss_price_review(uuid), public.dismiss_discount_review(uuid)
  from public, anon;
grant execute on function public.dismiss_price_review(uuid), public.dismiss_discount_review(uuid)
  to authenticated;
