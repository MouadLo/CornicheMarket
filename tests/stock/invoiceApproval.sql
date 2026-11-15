-- Approval rules for invoice drafts (migration 031). Runs in CI after
-- `supabase db reset` (see .github/workflows/ci.yml), as postgres, against the
-- seeded sample draft. Every write is rolled back.
begin;

select set_config('request.jwt.claim.sub', id::text, true)
from public.profiles where role = 'cashier' limit 1;
set local role authenticated;

do $$
begin
  if auth.uid() is null then
    raise exception 'Cashier seed is missing';
  end if;
  if exists (select 1 from public.invoice_drafts) then
    raise exception 'Cashier can read invoice drafts';
  end if;
  begin
    perform public.approve_invoice_draft('00000000-0000-0000-0000-00000000b001', 1, '[]');
    raise exception 'Cashier can approve invoice drafts';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);

do $$
declare
  v_draft uuid := '00000000-0000-0000-0000-00000000b001';
  v_milk uuid;
  v_stock numeric;
  v_lines jsonb;
  v_purchase uuid;
begin
  select id, stock_quantity into strict v_milk, v_stock
  from public.products where barcode = '6111000000020';

  v_lines := jsonb_build_array(
    jsonb_build_object('new_product', jsonb_build_object('name', 'Invoice test juice', 'selling_price_cents', 600),
      'unit', 'piece', 'quantity', 6, 'unit_cost_cents', 400),
    jsonb_build_object('product_id', v_milk, 'unit', 'piece', 'quantity', 24, 'unit_cost_cents', 900)
  );
  begin
    perform public.approve_invoice_draft(v_draft, 2, v_lines);
    raise exception 'Stale review was accepted';
  exception when sqlstate 'CM409' then null;
  end;

  begin
    perform public.approve_invoice_draft(v_draft, 1, jsonb_set(v_lines, '{1,unit_cost_cents}', '-1'));
    raise exception 'Invalid cost was accepted';
  exception when invalid_parameter_value then null;
  end;
  if exists (select 1 from public.products where name = 'Invoice test juice') then
    raise exception 'Failing approval left a product behind';
  end if;

  -- The product was deactivated while the owner was reviewing: refused, nothing written.
  update public.products set active = false where id = v_milk;
  begin
    perform public.approve_invoice_draft(v_draft, 1, v_lines);
    raise exception 'A deactivated product was accepted';
  exception when sqlstate 'CM412' then null;
  end;
  update public.products set active = true where id = v_milk;
  if exists (select 1 from public.products where name = 'Invoice test juice') then
    raise exception 'A refused approval left a product behind';
  end if;

  v_purchase := public.approve_invoice_draft(v_draft, 1, v_lines);
  if v_purchase is distinct from public.approve_invoice_draft(v_draft, 1, v_lines) then
    raise exception 'Retry did not return the original purchase';
  end if;
  begin
    perform public.approve_invoice_draft(v_draft, 1, jsonb_set(v_lines, '{0,quantity}', '7'));
    raise exception 'A conflicting retry was accepted';
  exception when sqlstate 'CM413' then null;
  end;

  if (select stock_quantity from public.products where id = v_milk) <> v_stock + 24
    or (select count(*) from public.products where name = 'Invoice test juice' and stock_quantity = 6) <> 1
    or (select count(*) from public.purchase_items where purchase_id = v_purchase) <> 2 then
    raise exception 'Approval did not receive exactly the reviewed quantities';
  end if;
  if not exists (select 1 from public.invoice_drafts where id = v_draft
    and purchase_id = v_purchase and approved_by = auth.uid() and approved_lines = v_lines) then
    raise exception 'The purchase was not linked to the review';
  end if;
end;
$$;

rollback;
