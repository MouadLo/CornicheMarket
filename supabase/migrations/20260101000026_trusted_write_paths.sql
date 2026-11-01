-- Audit C06 / U01 and the anon follow-up: money and stock change ONLY through
-- trusted functions, and an anonymous caller (anyone holding the public anon
-- key that ships in the app) can neither read nor call anything.
--
-- Before this migration (measured live, see tests/security/writePaths.live.test.ts):
--   * Supabase's default grants gave anon and authenticated every privilege on
--     every table and view, leaving RLS as the only barrier.
--   * A cashier could insert a sale header with any total, insert sale lines,
--     append lines to a voided sale, insert customer payments and stock
--     adjustments directly.
--   * The owner could rewrite or delete sales and payments and set stock or
--     average cost directly, bypassing void_sale and the stock triggers.
--   * A cashier could set any selling price or stock quantity by updating
--     products_cashier_view (views run as their owner and skip RLS).
--   * anon could execute batch_update_selling_prices, bulk_adjust_selling_price,
--     store_timezone and is_owner, and READ customer_balances (names, phones,
--     debts), products_cashier_view and product_sales_30d, because views run
--     as their owner and skip RLS.
--
-- Trusted write paths after this migration:
--   sales, sale_items       -> record_sale (now SECURITY DEFINER), void_sale
--   customer_payments       -> record_customer_payment (new, idempotent by id)
--   purchases, items        -> receive_delivery, void_purchase; owner-only
--                              direct INSERT kept for the CSV opening-stock
--                              import until R4 replaces it
--   stock_adjustments       -> owner-only direct INSERT kept (adjust/count)
--                              until T02's record_stock_adjustment lands
--   products stock / cost   -> triggers only; the owner edits every other column
--
-- Numbering: 022-023 are reserved for Codex T02.

-------------------------------------------------------------------------------
-- 1. record_sale: the only way to create a sale. SECURITY DEFINER so direct
--    INSERT on sales/sale_items can be revoked from every client role.
-------------------------------------------------------------------------------

-- The pre-occurred_at overload is no longer called by the app and runs with the
-- caller's rights, so it would stop working once direct inserts are revoked.
drop function if exists public.record_sale(uuid, uuid, public.payment_method, bigint, jsonb);

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
begin
  -- Runs with the definer's rights, so it checks the caller itself.
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

  -- Validate every line discount before computing or writing anything.
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

  -- Unchanged from 000017: a wrong device clock flags the sale, never drops it.
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

  -- Already recorded by an earlier attempt (offline retry): add nothing.
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

  return p_sale_id;
end;
$$;

-------------------------------------------------------------------------------
-- 2. record_customer_payment: the only way to record a credit repayment.
--    Idempotent by the client-generated id, like record_sale (also closes the
--    customer-payment half of audit C11).
-------------------------------------------------------------------------------
create function public.record_customer_payment(
  p_payment_id uuid,
  p_customer_id uuid,
  p_amount_cents bigint,
  p_method public.payment_method
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.customer_payments%rowtype;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles where id = v_actor and role in ('owner', 'cashier')
  ) then
    raise exception 'Authenticated staff required' using errcode = '42501';
  end if;
  if p_payment_id is null or p_customer_id is null or p_method is null
     or p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Invalid payment details' using errcode = '22023';
  end if;
  if p_method = 'credit' then
    raise exception 'A credit repayment cannot itself be on credit' using errcode = '22023';
  end if;

  insert into public.customer_payments (id, customer_id, amount_cents, method, created_by)
  values (p_payment_id, p_customer_id, p_amount_cents, p_method, v_actor)
  on conflict (id) do nothing;

  if found then
    return p_payment_id;
  end if;

  -- Retry of the same payment: fine. Same id, different payload: refuse,
  -- without revealing anything about the existing row.
  select * into v_existing from public.customer_payments where id = p_payment_id;
  if not found or v_existing.created_by is distinct from v_actor
     or v_existing.customer_id is distinct from p_customer_id
     or v_existing.amount_cents is distinct from p_amount_cents
     or v_existing.method is distinct from p_method then
    raise exception 'Payment ID conflicts with payment details' using errcode = '22023';
  end if;
  return p_payment_id;
end;
$$;

-------------------------------------------------------------------------------
-- 3. Table privileges: no direct money or stock writes from client roles.
-------------------------------------------------------------------------------

-- TRUNCATE, REFERENCES and TRIGGER are never needed by a client, and TRUNCATE
-- ignores RLS altogether.
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- Views are read-only for clients. A simple view is automatically updatable
-- and runs as its owner, skipping RLS and column grants: before this, a
-- cashier could set any selling price or stock quantity by updating
-- products_cashier_view.
do $$
declare
  v_view text;
begin
  for v_view in select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  loop
    execute format('revoke insert, update, delete on public.%I from authenticated', v_view);
  end loop;
end;
$$;

-- Sales and payments: functions only.
revoke insert, update, delete on public.sales, public.sale_items, public.customer_payments
  from authenticated;

-- Cost history is written by triggers only.
revoke insert, update, delete on public.cost_history from authenticated;

-- Deliveries: receive_delivery / void_purchase. The owner keeps direct INSERT
-- (RLS: owner only) for the CSV opening-stock import, until R4.
revoke update, delete on public.purchases, public.purchase_items from authenticated;

-- Stock adjustments are a ledger: never edited or deleted. Direct INSERT stays
-- for the owner's adjust/count screens (until T02's record_stock_adjustment),
-- but a cashier can no longer insert one.
revoke update, delete on public.stock_adjustments from authenticated;
drop policy if exists "staff record adjustments" on public.stock_adjustments;
create policy "owner records adjustments" on public.stock_adjustments
  for insert with check (public.is_owner() and created_by = auth.uid());

-- Products: the owner edits everything except stock and average cost, which
-- only the purchase / sale / adjustment triggers may change.
revoke insert, update on public.products from authenticated;
grant insert (id, name, barcode, category_id, unit, selling_price_cents,
              low_stock_threshold, active)
  on public.products to authenticated;
grant update (name, barcode, category_id, unit, selling_price_cents,
              low_stock_threshold, active, updated_at)
  on public.products to authenticated;

-------------------------------------------------------------------------------
-- 4. anon: nothing. The app only uses anon to reach the Auth API.
-------------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;

-- Same for objects created by later migrations (Supabase's defaults would
-- otherwise grant them to anon again).
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

-------------------------------------------------------------------------------
-- 5. authenticated: EXECUTE only on what the app calls (plus is_owner, which
--    RLS policies call as the querying user). Trigger functions need no
--    EXECUTE grant to fire.
-------------------------------------------------------------------------------
-- Internal functions (triggers and helpers) are never called by a client. An
-- explicit list, not "all functions": T02's 022-023 sort before this file and
-- grant their own functions to authenticated, which must survive a db reset.
revoke execute on function
  public.apply_purchase_item(),
  public.apply_purchase_void(),
  public.apply_sale_item_stock(),
  public.apply_stock_adjustment(),
  public.guard_purchase_void(),
  public.handle_new_user(),
  public.prevent_role_self_escalation(),
  public.refuse_item_on_voided_purchase(),
  public.set_updated_at(),
  public.stamp_adjustment_cost(),
  public.stamp_sale_item_cost(),
  public.track_negative_stock(),
  public.void_line_effect(numeric, bigint, numeric, bigint, bigint)
from authenticated;

grant execute on function
  public.record_sale(uuid, uuid, public.payment_method, bigint, jsonb, timestamptz),
  public.record_customer_payment(uuid, uuid, bigint, public.payment_method),
  public.void_sale(uuid, text),
  public.receive_delivery(uuid, uuid, text, jsonb, jsonb, date),
  public.void_purchase(uuid, text),
  public.preview_void_purchase(uuid),
  public.batch_update_selling_prices(jsonb),
  public.bulk_adjust_selling_price(uuid, numeric),
  public.report_summary(timestamptz, timestamptz),
  public.report_daily_trend(timestamptz, timestamptz),
  public.report_by_category(timestamptz, timestamptz),
  public.report_by_hour(timestamptz, timestamptz),
  public.report_product_performance(timestamptz, timestamptz),
  public.report_dead_stock(integer),
  public.report_inventory_value(),
  public.store_timezone(),
  public.is_owner()
to authenticated;
