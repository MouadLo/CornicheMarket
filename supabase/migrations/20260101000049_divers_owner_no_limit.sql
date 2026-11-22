-- Divers: the owner has no maximum amount.
--
-- 032 made record_sale refuse a Divers line above store_settings.divers_max_cents
-- for everyone. That limit is a guard against a cashier's slip, not against the
-- owner, so it now applies only when the caller is not the owner. Everything else
-- about a Divers line is unchanged and holds for everyone: the amount must be
-- above 0, the quantity is always 1, the note is at most 60 characters.
--
-- Append-only: this is 048's record_sale, byte for byte, with ONE changed
-- condition (marked below). Same signature, so create or replace is enough; the
-- grants are repeated exactly as 048 has them. recover_sale calls record_sale
-- positionally, so it follows without a change; no other function has the check.

create or replace function public.record_sale(
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
      if (v_line ->> 'unit_price_cents')::bigint <= 0 then
        raise exception 'A Divers amount must be above 0 and within the maximum' using errcode = '22023';
      end if;
      -- Changed in 049: the maximum is for cashiers only.
      if not public.is_owner()
         and (v_line ->> 'unit_price_cents')::bigint > coalesce(v_divers_max, 20000) then
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
