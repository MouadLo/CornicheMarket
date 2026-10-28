-- ============================================================
-- Reject an over-large discount explicitly, with a readable message,
-- instead of letting it fall through to the sale_items CHECK constraint
-- (line_total_cents >= 0). That CHECK rolling back the whole transaction
-- produces an opaque constraint-violation message, which the offline
-- queue's error classifier treats as a permanent failure and quarantines
-- -- exactly the outcome this is meant to avoid.
--
-- Client-side validation (CartLineRow's discount field, the sale-level
-- discount field, and a guard in handleConfirm before enqueueSale) should
-- already stop this before it ever reaches the RPC. This is the backstop
-- for anything that reaches record_sale despite that -- a stale client, a
-- direct API call, or a sale already queued before this shipped.
--
-- Only the current (6-arg, p_occurred_at) overload is touched. The 5-arg
-- overload is -- per the policy established in
-- 20260101000017_sale_occurred_at.sql -- left completely untouched so an
-- already-installed app keeps working unchanged; it will still hit the
-- CHECK constraint on an invalid discount, same as before this migration.
-- ============================================================

create or replace function public.record_sale(
  p_sale_id uuid,
  p_customer_id uuid,
  p_payment_method payment_method,
  p_discount_cents bigint,
  p_lines jsonb,
  p_occurred_at timestamptz
)
returns uuid
language plpgsql
as $$
declare
  v_line jsonb;
  v_lines_total bigint;
  v_needs_review boolean;
  v_line_subtotal bigint;
  v_line_discount bigint;
begin
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

  -- A badly wrong device clock must not be able to silently inject a sale
  -- into last year's reports or next month's forecast. The sale is still
  -- recorded exactly as reported -- sale data is never discarded -- but it
  -- is flagged, and created_at (the server's own clock, via its column
  -- default) sits right next to occurred_at so the drift is visible to
  -- whoever reviews it.
  v_needs_review := p_occurred_at > now() + interval '24 hours'
    or p_occurred_at < now() - interval '30 days';

  insert into sales (
    id, cashier_id, customer_id, payment_method, discount_cents, total_cents,
    occurred_at, needs_clock_review
  )
  values (
    p_sale_id,
    auth.uid(),
    p_customer_id,
    p_payment_method,
    p_discount_cents,
    v_lines_total - p_discount_cents,
    p_occurred_at,
    v_needs_review
  )
  on conflict (id) do nothing;

  -- Already recorded by an earlier attempt: return quietly, add nothing.
  if not found then
    return p_sale_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into sale_items (sale_id, product_id, quantity, unit_price_cents, discount_cents)
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

grant execute on function public.record_sale(uuid, uuid, payment_method, bigint, jsonb, timestamptz) to authenticated;
