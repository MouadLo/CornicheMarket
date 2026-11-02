-- Divers on the server (Sell grid PR 2): one built-in free-amount item.
--
--   * products.kind / track_stock, and exactly one 'misc' product named Divers
--     that can be neither deactivated, deleted nor turned into something else;
--   * no stock movement for it (sale, void), and never "low stock";
--   * sale_items.note (60 characters) and cost_estimated; the cost of a Divers
--     line is estimated from owner_settings.divers_margin_percent and stamped
--     server-side, like every cost. The margin is cost information, so it is in
--     the owner-only table; the maximum amount is not, so it is in store_settings;
--   * record_sale refuses a Divers line above the maximum, at or below 0, with a
--     quantity other than 1, or with a note over 60 characters;
--   * every Divers line is written to activity_log with its cashier
--     ('divers_sale'), and voiding the sale writes 'divers_void' per line.
--
-- Append-only: new columns and replaced functions, nothing dropped. The two
-- reports changes (Divers as its own line, out of the rankings) are a later step.

-------------------------------------------------------------------------------
-- 1. products: kind, track_stock, the Divers row, and its guard
-------------------------------------------------------------------------------
alter table public.products
  add column kind text not null default 'regular' check (kind in ('regular', 'misc')),
  add column track_stock boolean not null default true;

create unique index one_misc_product on public.products (kind) where kind = 'misc';

-- A threshold of -1 keeps the generated is_low_stock false at stock 0.
insert into public.products (name, kind, track_stock, selling_price_cents, unit, low_stock_threshold)
values ('Divers', 'misc', false, 0, 'piece', -1);

create function public.guard_misc_product()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'misc' then
      raise exception 'The Divers item cannot be deleted';
    end if;
    return old;
  end if;
  if new.kind is distinct from old.kind then
    raise exception 'A product cannot become or stop being Divers';
  end if;
  if old.kind = 'misc' and (new.active is not true or new.track_stock) then
    raise exception 'The Divers item cannot be deactivated or tracked in stock';
  end if;
  return new;
end;
$$;

create trigger trg_products_guard_misc
  before update or delete on public.products
  for each row execute function public.guard_misc_product();

-- create or replace view can only append columns.
create or replace view public.products_cashier_view as
select
  id, name, barcode, category_id, unit,
  selling_price_cents, stock_quantity, low_stock_threshold, active,
  created_at, updated_at, is_low_stock,
  kind, track_stock
from public.products;

-------------------------------------------------------------------------------
-- 2. settings: the maximum (readable by all) and the margin (owner only)
-------------------------------------------------------------------------------
alter table public.store_settings
  add column divers_max_cents bigint not null default 20000 check (divers_max_cents > 0);
grant update (divers_max_cents) on public.store_settings to authenticated;

alter table public.owner_settings
  add column divers_margin_percent numeric(5,2) not null default 20
    check (divers_margin_percent between 0 and 95);
grant update (divers_margin_percent) on public.owner_settings to authenticated;

-------------------------------------------------------------------------------
-- 3. sale_items: note and cost_estimated
-------------------------------------------------------------------------------
alter table public.sale_items
  add column note text check (char_length(note) <= 60),
  add column cost_estimated boolean not null default false;

create or replace function public.stamp_sale_item_cost()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_cost bigint;
  v_stock numeric;
  v_kind text;
  v_margin numeric;
begin
  select current_cost_cents, stock_quantity, kind
    into v_cost, v_stock, v_kind
  from products
  where id = new.product_id;

  if v_kind = 'misc' then
    -- No purchase cost exists: estimate it from the owner's margin, and say so.
    select divers_margin_percent into v_margin from owner_settings where singleton;
    new.unit_cost_cents := round(new.unit_price_cents * (1 - coalesce(v_margin, 20) / 100.0));
    new.cost_estimated := true;
    new.oversold := false;
  else
    new.unit_cost_cents := v_cost;
    new.cost_estimated := false;
    new.oversold := v_stock < new.quantity;
  end if;

  new.line_total_cents := (new.quantity * new.unit_price_cents)::bigint - new.discount_cents;
  return new;
end;
$$;

create or replace function public.apply_sale_item_stock()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update products
  set stock_quantity = stock_quantity - new.quantity
  where id = new.product_id and track_stock;

  return new;
end;
$$;

create function public.log_divers_sale()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_cashier uuid;
begin
  if not exists (select 1 from products where id = new.product_id and kind = 'misc') then
    return new;
  end if;
  select cashier_id into v_cashier from sales where id = new.sale_id;
  insert into activity_log (actor_id, action, entity_id, details)
  values (
    v_cashier,
    'divers_sale',
    new.id,
    jsonb_build_object(
      'sale_id', new.sale_id,
      'amount_cents', new.line_total_cents,
      'note', new.note,
      'cost_estimated', true
    )
  );
  return new;
end;
$$;

create trigger trg_sale_items_log_divers
  after insert on public.sale_items
  for each row execute function public.log_divers_sale();

-------------------------------------------------------------------------------
-- 4. void_sale: no stock back for untracked items, one divers_void per Divers line
-------------------------------------------------------------------------------
create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only an owner can void a sale';
  end if;

  update sales
  set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
  where id = p_sale_id and voided_at is null;

  -- Already voided, or no such sale: never restore the stock twice.
  if not found then
    return;
  end if;

  -- Aggregated first: a sale may contain the same product on several lines,
  -- and UPDATE ... FROM would otherwise apply only one of them.
  update products p
  set stock_quantity = p.stock_quantity + agg.quantity
  from (
    select product_id, sum(quantity) as quantity
    from sale_items
    where sale_id = p_sale_id
    group by product_id
  ) agg
  where agg.product_id = p.id and p.track_stock;

  -- The original divers_sale rows stay; the void is its own entry, with the
  -- voiding user as actor and the original cashier and the reason in details.
  insert into activity_log (actor_id, action, entity_id, details)
  select
    auth.uid(),
    'divers_void',
    si.id,
    jsonb_build_object(
      'sale_id', si.sale_id,
      'amount_cents', si.line_total_cents,
      'note', si.note,
      'original_cashier_id', s.cashier_id,
      'void_reason', p_reason
    )
  from sale_items si
  join sales s on s.id = si.sale_id
  join products pr on pr.id = si.product_id
  where si.sale_id = p_sale_id and pr.kind = 'misc';
end;
$$;

-------------------------------------------------------------------------------
-- 5. record_sale: same as 028, plus the Divers rules
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

  return p_sale_id;
end;
$$;


-- Trigger functions are not callable by clients (see 026).
revoke execute on function
  public.guard_misc_product(),
  public.log_divers_sale()
from public, anon, authenticated;
