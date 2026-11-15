-- Invoice scanning, part 1: drafts and their approval.
--
-- A draft holds the lines read from a supplier invoice. Nothing about it
-- touches stock: stock and cost change only when the owner approves, through
-- approve_invoice_draft, which posts the reviewed lines with receive_delivery
-- in the same transaction. So a purchase always has exactly the reviewed lines.
--
-- Drafts are owner-only (an invoice shows cost prices). No client can create
-- one yet: the extraction step (photo -> draft) comes in a later migration and
-- writes with the service role. The local seed has one sample draft.
--
-- Error codes the app tells apart:
--   CM409  the draft changed since it was opened (re-open it)
--   CM412  a chosen product was deactivated or its stock unit changed
--   CM413  already approved, with different lines
--   22023  a reviewed line is incomplete or invalid
create table public.invoice_drafts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id),
  invoice_number text not null check (btrim(invoice_number) <> ''),
  source_lines jsonb not null check (jsonb_typeof(source_lines) = 'array'),
  revision integer not null default 1 check (revision > 0),
  purchase_id uuid unique references public.purchases (id),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  approved_lines jsonb,
  created_at timestamptz not null default now(),
  check (
    (purchase_id is null and approved_by is null and approved_at is null and approved_lines is null)
    or
    (purchase_id is not null and approved_by is not null and approved_at is not null and approved_lines is not null)
  )
);

create unique index invoice_drafts_supplier_number
  on public.invoice_drafts (supplier_id, lower(btrim(invoice_number)));

alter table public.invoice_drafts enable row level security;
revoke all on public.invoice_drafts from public, anon, authenticated;
grant select on public.invoice_drafts to authenticated;
create policy "owner reads invoice drafts" on public.invoice_drafts
  for select to authenticated using ((select public.is_owner()));

create function public.approve_invoice_draft(
  p_draft_id uuid, p_revision integer, p_review_lines jsonb
)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_draft public.invoice_drafts%rowtype;
  v_line jsonb;
  v_new jsonb;
  v_product_id uuid;
  v_unit public.product_unit;
  v_quantity numeric;
  v_selling_price numeric;
  v_name text;
  v_receive_lines jsonb := '[]'::jsonb;
  v_purchase_id uuid;
begin
  if v_actor is null or not public.is_owner() then
    raise exception 'Only the owner can approve an invoice' using errcode = '42501';
  end if;

  select * into v_draft from public.invoice_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'Invoice draft not found' using errcode = '22023';
  end if;
  if v_draft.revision is distinct from p_revision then
    raise exception 'The invoice draft has changed' using errcode = 'CM409';
  end if;
  if v_draft.purchase_id is not null then
    if v_draft.approved_lines is distinct from p_review_lines then
      raise exception 'This invoice was already approved with different details' using errcode = 'CM413';
    end if;
    return v_draft.purchase_id;
  end if;

  if jsonb_typeof(p_review_lines) is distinct from 'array' then
    raise exception 'Reviewed lines must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_review_lines) not between 1 and 500
    or jsonb_array_length(p_review_lines) <> jsonb_array_length(v_draft.source_lines) then
    raise exception 'Review every invoice line before approving' using errcode = '22023';
  end if;

  for v_line in select value from jsonb_array_elements(p_review_lines) loop
    v_product_id := (v_line ->> 'product_id')::uuid;
    v_new := nullif(v_line -> 'new_product', 'null'::jsonb);
    v_unit := (v_line ->> 'unit')::public.product_unit;

    if (v_product_id is null) = (v_new is null) or v_unit is null then
      raise exception 'Choose one product and its stock unit for every line' using errcode = '22023';
    end if;
    if jsonb_typeof(v_line -> 'quantity') is distinct from 'number'
      or jsonb_typeof(v_line -> 'unit_cost_cents') is distinct from 'number' then
      raise exception 'Enter a quantity and unit cost for every line' using errcode = '22023';
    end if;
    v_quantity := (v_line ->> 'quantity')::numeric;
    if v_unit <> 'kg' and v_quantity <> trunc(v_quantity) then
      raise exception 'Pieces and packs must be received as whole units' using errcode = '22023';
    end if;

    if v_new is not null then
      v_name := btrim(v_new ->> 'name');
      if nullif(v_name, '') is null or length(v_name) > 150
        or jsonb_typeof(v_new -> 'selling_price_cents') is distinct from 'number' then
        raise exception 'New products need a name and selling price' using errcode = '22023';
      end if;
      v_selling_price := (v_new ->> 'selling_price_cents')::numeric;
      if v_selling_price not between 0 and 100000000 or v_selling_price <> trunc(v_selling_price) then
        raise exception 'Invalid selling price' using errcode = '22023';
      end if;
      insert into public.products (name, barcode, unit, selling_price_cents)
      values (v_name, nullif(btrim(v_new ->> 'barcode'), ''), v_unit, v_selling_price::bigint)
      returning id into v_product_id;
    else
      perform 1 from public.products
      where id = v_product_id and active and unit = v_unit
      for update;
      if not found then
        raise exception 'A selected product or its stock unit has changed' using errcode = 'CM412';
      end if;
    end if;

    v_receive_lines := v_receive_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'quantity', v_quantity,
      'unit_cost_cents', v_line -> 'unit_cost_cents'
    ));
  end loop;

  v_purchase_id := public.receive_delivery(
    v_draft.id, v_draft.supplier_id, v_draft.invoice_number, v_receive_lines
  );
  update public.invoice_drafts set
    purchase_id = v_purchase_id,
    approved_by = v_actor,
    approved_at = now(),
    approved_lines = p_review_lines
  where id = v_draft.id;

  return v_purchase_id;
end;
$$;

revoke all on function public.approve_invoice_draft(uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.approve_invoice_draft(uuid, integer, jsonb) to authenticated;
