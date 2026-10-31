-- Receiving a delivery used to be three separate requests from the app:
-- insert the purchase header, insert its lines, then update selling prices.
-- A failure after the first one left a half-saved delivery (audit C07), and
-- pressing Save again received the stock a second time (audit C03).
--
-- receive_delivery does all of it in one transaction, and is keyed by an
-- operation id the app generates once per delivery and keeps until the save
-- is confirmed. A retry with the same id and the same details returns the
-- purchase already recorded instead of receiving again; the same id with
-- different details is refused, because the first attempt may have landed.
--
-- Stock and weighted-average cost are still written only by the existing
-- apply_purchase_item trigger, fired by the line inserts below.
--
-- Numbered 024 to leave 022-023 to the in-progress shelf-count work (T02).

alter table purchases
  add column operation_id uuid unique,
  add column payload_hash text;

create function public.receive_delivery(
  p_operation_id uuid,
  p_supplier_id uuid,
  p_notes text,
  p_lines jsonb,
  p_price_updates jsonb default '[]'::jsonb,
  p_delivery_date date default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_line jsonb;
  v_index integer;
  v_product uuid;
  v_quantity numeric;
  v_cost numeric;
  v_price numeric;
  v_expiry_text text;
  v_expiry date;
  v_lines jsonb := '[]'::jsonb;
  v_prices jsonb := '[]'::jsonb;
  v_today date;
  v_purchase_date timestamptz;
  v_hash text;
  v_purchase_id uuid;
  v_existing_hash text;
begin
  if v_actor is null or not public.is_owner() then
    raise exception 'Only the owner can receive deliveries' using errcode = '42501';
  end if;

  if p_operation_id is null then
    raise exception 'Missing operation id' using errcode = '22023';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 500 then
    raise exception 'A delivery needs between 1 and 500 lines' using errcode = '22023';
  end if;

  if p_supplier_id is not null and not exists (select 1 from suppliers where id = p_supplier_id) then
    raise exception 'Unknown supplier' using errcode = '22023';
  end if;

  -- Validate and normalise every line before writing anything. The
  -- normalised form (fixed numeric scale, parsed date) is also what the
  -- payload hash is computed from, so 10 and 10.0 count as the same delivery.
  for v_line, v_index in select value, ordinality from jsonb_array_elements(p_lines) with ordinality
  loop
    begin
      v_product := (v_line ->> 'product_id')::uuid;
      v_quantity := (v_line ->> 'quantity')::numeric;
      v_cost := (v_line ->> 'unit_cost_cents')::numeric;
    exception when others then
      raise exception 'Line %: invalid product, quantity or cost', v_index using errcode = '22023';
    end;

    if v_product is null or not exists (select 1 from products where id = v_product) then
      raise exception 'Line %: unknown product', v_index using errcode = '22023';
    end if;
    if v_quantity is null or v_quantity <= 0 or v_quantity >= 1000000
       or v_quantity <> round(v_quantity, 3) then
      raise exception 'Line %: quantity must be above 0, below 1 000 000, at most 3 decimals', v_index
        using errcode = '22023';
    end if;
    if v_cost is null or v_cost < 0 or v_cost > 100000000 or v_cost <> trunc(v_cost) then
      raise exception 'Line %: unit cost must be whole centimes, 0 or more', v_index using errcode = '22023';
    end if;

    -- Shape first: Postgres would otherwise accept 'tomorrow' or '20260331'.
    v_expiry_text := nullif(btrim(coalesce(v_line ->> 'expiry_date', '')), '');
    v_expiry := null;
    if v_expiry_text is not null then
      if v_expiry_text !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Line %: expiry date % is not a real date', v_index, v_expiry_text using errcode = '22023';
      end if;
      begin
        v_expiry := v_expiry_text::date;
      exception when others then
        raise exception 'Line %: expiry date % is not a real date', v_index, v_expiry_text using errcode = '22023';
      end;
    end if;

    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product,
      'quantity', round(v_quantity, 3),
      'unit_cost_cents', v_cost::bigint,
      'expiry_date', v_expiry
    );
  end loop;

  if p_price_updates is not null and jsonb_typeof(p_price_updates) = 'array' then
    for v_line, v_index in select value, ordinality from jsonb_array_elements(p_price_updates) with ordinality
    loop
      begin
        v_product := (v_line ->> 'product_id')::uuid;
        v_price := (v_line ->> 'selling_price_cents')::numeric;
      exception when others then
        raise exception 'Price change %: invalid product or price', v_index using errcode = '22023';
      end;
      if v_product is null or not exists (select 1 from products where id = v_product) then
        raise exception 'Price change %: unknown product', v_index using errcode = '22023';
      end if;
      if v_price is null or v_price < 0 or v_price > 100000000 or v_price <> trunc(v_price) then
        raise exception 'Price change %: selling price must be whole centimes, 0 or more', v_index
          using errcode = '22023';
      end if;
      v_prices := v_prices || jsonb_build_object('product_id', v_product, 'selling_price_cents', v_price::bigint);
    end loop;
  elsif p_price_updates is not null and jsonb_typeof(p_price_updates) <> 'null' then
    raise exception 'Price changes must be a list' using errcode = '22023';
  end if;

  -- Delivery date: today by default; never in the future, at most 60 days
  -- back, judged in the store's own timezone. A past date is stored as noon
  -- local time on that day so it lands in the right day and month.
  v_today := (now() at time zone public.store_timezone())::date;
  if p_delivery_date is null or p_delivery_date = v_today then
    v_purchase_date := now();
  elsif p_delivery_date > v_today then
    raise exception 'Delivery date % is in the future', p_delivery_date using errcode = '22023';
  elsif p_delivery_date < v_today - 60 then
    raise exception 'Delivery date % is more than 60 days ago', p_delivery_date using errcode = '22023';
  else
    v_purchase_date := (p_delivery_date + time '12:00') at time zone public.store_timezone();
  end if;

  v_hash := md5(jsonb_build_object(
    'supplier_id', p_supplier_id,
    'notes', coalesce(p_notes, ''),
    'delivery_date', p_delivery_date,
    'lines', v_lines,
    'prices', v_prices
  )::text);

  insert into purchases (operation_id, payload_hash, supplier_id, created_by, purchase_date, notes)
  values (p_operation_id, v_hash, p_supplier_id, v_actor, v_purchase_date, p_notes)
  on conflict (operation_id) do nothing
  returning id into v_purchase_id;

  if v_purchase_id is null then
    -- A concurrent or earlier call with this id committed first.
    select id, payload_hash into v_purchase_id, v_existing_hash
    from purchases
    where operation_id = p_operation_id;

    if v_existing_hash is distinct from v_hash then
      raise exception 'This delivery was already saved with different details' using errcode = 'CM409';
    end if;
    return v_purchase_id;
  end if;

  insert into purchase_items (purchase_id, product_id, quantity, unit_cost_cents, expiry_date)
  select v_purchase_id,
         (line ->> 'product_id')::uuid,
         (line ->> 'quantity')::numeric,
         (line ->> 'unit_cost_cents')::bigint,
         (line ->> 'expiry_date')::date
  from jsonb_array_elements(v_lines) with ordinality as l(line, position)
  order by position;

  update products p
  set selling_price_cents = (u ->> 'selling_price_cents')::bigint
  from jsonb_array_elements(v_prices) as u
  where p.id = (u ->> 'product_id')::uuid;

  return v_purchase_id;
end;
$$;

revoke all on function public.receive_delivery(uuid, uuid, text, jsonb, jsonb, date) from public;
grant execute on function public.receive_delivery(uuid, uuid, text, jsonb, jsonb, date) to authenticated;

-- Only the owner receives stock. The direct-insert policies stay for now
-- because the CSV opening-stock import still writes purchases directly
-- (audit C10, moved onto its own RPC later); they no longer let a cashier
-- create empty purchase headers.
drop policy "staff record purchases" on purchases;
create policy "owner records purchases" on purchases
  for insert with check (public.is_owner() and created_by = auth.uid());

drop policy "staff record purchase items" on purchase_items;
create policy "owner records purchase items" on purchase_items
  for insert with check (public.is_owner());
