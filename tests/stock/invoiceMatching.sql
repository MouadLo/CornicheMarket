-- Matching, aliases, invoice-dated deliveries and duplicate checks (migration
-- 034). Runs in CI after `supabase db reset`, as postgres, against the seeded
-- sample draft. Every write is rolled back.
begin;

-- A manual delivery whose note is an invoice number, and a second draft from
-- the same supplier, prepared as postgres before switching roles.
insert into public.purchases (id, supplier_id, created_by, notes)
values ('00000000-0000-0000-0000-00000000c034', '00000000-0000-0000-0000-00000000a001',
        '00000000-0000-0000-0000-0000000000aa', 'FAC-77');
insert into public.invoice_drafts (id, supplier_id, invoice_number, source_lines)
values ('00000000-0000-0000-0000-00000000b034', '00000000-0000-0000-0000-00000000a001', ' fac-77 ',
  '[{"description":"LAIT  Centrale danone 1L","billed":"1 carton","billing_unit":null,"quantity":"","unit":"piece","unit_cost":""},
    {"description":"Article inconnu zzqx","billed":"1","billing_unit":null,"quantity":"1","unit":"piece","unit_cost":"5"},
    {"description":"Divers","billed":"1","billing_unit":null,"quantity":"1","unit":"piece","unit_cost":"5"}]');

do $$
begin
  if not exists (select 1 from public.invoice_drafts
                 where id = '00000000-0000-0000-0000-00000000b034' and 'duplicate_invoice' = any(flags)) then
    raise exception 'A draft repeating a saved delivery was not flagged';
  end if;
end;
$$;

set local role anon;
do $$
begin
  perform 1 from public.supplier_product_aliases;
  raise exception 'Anonymous users can read supplier aliases';
exception when insufficient_privilege then null;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', id::text, true)
from public.profiles where role = 'cashier' limit 1;
set local role authenticated;

do $$
begin
  if exists (select 1 from public.supplier_product_aliases) then
    raise exception 'Cashier can read supplier aliases';
  end if;
  begin
    perform * from public.match_invoice_lines('00000000-0000-0000-0000-00000000b001');
    raise exception 'Cashier can match invoice lines';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);

do $$
declare
  v_draft uuid := '00000000-0000-0000-0000-00000000b001';
  v_second uuid := '00000000-0000-0000-0000-00000000b034';
  v_milk uuid;
  v_juice uuid;
  v_today date := (now() at time zone coalesce(
    (select timezone from public.store_settings limit 1), 'Africa/Casablanca'))::date;
  v_lines jsonb;
  v_purchase uuid;
  v_revision integer;
begin
  select id into strict v_milk from public.products where barcode = '6111000000020';

  -- Before any approval there is no alias: name candidates only, at most 3.
  if exists (select 1 from public.match_invoice_lines(v_draft) where exact) then
    raise exception 'An alias matched before any approval';
  end if;
  if (select count(*) from public.match_invoice_lines(v_draft) where line_index = 0) > 3
    or not exists (select 1 from public.match_invoice_lines(v_draft)
                   where line_index = 0 and product_id = v_milk) then
    raise exception 'Name candidates are missing or more than three';
  end if;
  select product_id into v_juice from public.match_invoice_lines(v_draft)
  where line_index = 1 order by score desc limit 1;
  if v_juice is null then
    raise exception 'The juice line has no candidate';
  end if;

  -- A future invoice date is refused at the header and at approval.
  begin
    perform public.update_invoice_draft_header(v_draft, 1,
      '00000000-0000-0000-0000-00000000a001', 'DEMO-001', v_today + 1);
    raise exception 'A future invoice date was saved';
  exception when sqlstate 'CM414' then null;
  end;
  v_revision := public.update_invoice_draft_header(v_draft, 1,
    '00000000-0000-0000-0000-00000000a001', 'DEMO-001', v_today - 3);

  -- One carton of 12 milk at 108.00 DH reviewed as 24 pieces at 9.00 DH.
  v_lines := jsonb_build_array(
    jsonb_build_object('product_id', v_milk, 'unit', 'piece', 'quantity', 24,
      'unit_cost_cents', 900, 'units_per_billing_unit', 12),
    jsonb_build_object('product_id', v_juice, 'unit', 'piece', 'quantity', 6, 'unit_cost_cents', 400)
  );
  begin
    perform public.approve_invoice_draft(v_draft, v_revision,
      jsonb_set(v_lines, '{0,units_per_billing_unit}', '0'));
    raise exception 'Zero units per billing unit was accepted';
  exception when invalid_parameter_value then null;
  end;
  v_purchase := public.approve_invoice_draft(v_draft, v_revision, v_lines);

  if (select (purchase_date at time zone 'Africa/Casablanca')::date
      from public.purchases where id = v_purchase) <> v_today - 3 then
    raise exception 'The delivery is not dated from the invoice';
  end if;
  if not exists (select 1 from public.supplier_product_aliases
    where supplier_id = '00000000-0000-0000-0000-00000000a001'
      and alias_key = 'lait centrale danone 1l' and billing_unit_key = ''
      and product_id = v_milk and units_per_billing_unit = 12) then
    raise exception 'Approval did not record the alias';
  end if;

  -- The next invoice from that supplier, same wording with other spacing and
  -- case: matched exactly, with the pack size. Unknown words and the Divers
  -- line get no suggestion.
  if not exists (select 1 from public.match_invoice_lines(v_second)
    where line_index = 0 and exact and product_id = v_milk and units_per_billing_unit = 12) then
    raise exception 'The alias did not match the next invoice';
  end if;
  if (select count(*) from public.match_invoice_lines(v_second) where line_index = 0) <> 1 then
    raise exception 'An exact alias still listed name candidates';
  end if;
  if exists (select 1 from public.match_invoice_lines(v_second) where line_index in (1, 2)) then
    raise exception 'An unknown line or Divers got a suggestion';
  end if;

  -- Changing the number re-runs the duplicate check instead of keeping a stale flag.
  perform public.update_invoice_draft_header(v_second, 1,
    '00000000-0000-0000-0000-00000000a001', 'FAC-78', null);
  if exists (select 1 from public.invoice_drafts where id = v_second and 'duplicate_invoice' = any(flags)) then
    raise exception 'The duplicate flag stayed after the number changed';
  end if;
  perform public.update_invoice_draft_header(v_second, 2,
    '00000000-0000-0000-0000-00000000a001', 'FAC-77', null);
  if not exists (select 1 from public.invoice_drafts where id = v_second and 'duplicate_invoice' = any(flags)) then
    raise exception 'Editing back to a saved number was not flagged';
  end if;

  -- Approving the same wording again refreshes the alias (now 6 per carton).
  perform public.approve_invoice_draft(v_second, 3, jsonb_build_array(
    jsonb_build_object('product_id', v_milk, 'unit', 'piece', 'quantity', 6,
      'unit_cost_cents', 900, 'units_per_billing_unit', 6),
    jsonb_build_object('product_id', v_juice, 'unit', 'piece', 'quantity', 1, 'unit_cost_cents', 500),
    jsonb_build_object('product_id', v_juice, 'unit', 'piece', 'quantity', 1, 'unit_cost_cents', 500)
  ));
  if (select count(*) from public.supplier_product_aliases
      where supplier_id = '00000000-0000-0000-0000-00000000a001' and alias_key = 'lait centrale danone 1l') <> 1
    or not exists (select 1 from public.supplier_product_aliases
      where alias_key = 'lait centrale danone 1l' and units_per_billing_unit = 6) then
    raise exception 'The alias was duplicated or not refreshed';
  end if;
end;
$$;

rollback;
