-- Invoice scanning, part 2: private photo capture, extraction and header review.
-- CM409: draft changed. CM412: chosen product changed. CM413: already posted.
-- 22023: missing header, invalid input or draft not ready.
-- 23505: a different draft already has the same supplier and invoice number.

alter table public.invoice_drafts
  alter column supplier_id drop not null,
  alter column invoice_number drop not null,
  add column status text not null default 'ready' check (status in ('extracting','ready','failed')),
  add column photo_paths text[] not null default '{}',
  add column invoice_date date,
  add column totals jsonb,
  add column flags text[] not null default '{}',
  add column extraction jsonb,
  add column extraction_usage jsonb,
  add column extraction_error text,
  add column created_by uuid references public.profiles,
  add column extraction_attempt uuid,
  add column extraction_started_at timestamptz;

drop index public.invoice_drafts_supplier_number;
create unique index invoice_drafts_supplier_number
  on public.invoice_drafts (supplier_id, lower(btrim(invoice_number)))
  where invoice_number is not null;

grant select, update on public.invoice_drafts to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 4000000, array['image/jpeg']);

create policy "owners read invoice photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'invoices' and (select public.is_owner()));

create policy "owners upload invoice photos before extraction" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'invoices' and (select public.is_owner())
    and exists (
      select 1 from public.invoice_drafts d
      where d.id::text = (storage.foldername(name))[1]
        and name in (d.id::text || '/1.jpg', d.id::text || '/2.jpg', d.id::text || '/3.jpg')
        and d.status = 'extracting' and d.extraction_attempt is null
    )
  );

create function public.create_invoice_draft() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception 'Only an owner can create invoice drafts' using errcode = '42501';
  end if;
  insert into public.invoice_drafts (status, source_lines, created_by)
  values ('extracting', '[]', auth.uid()) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_invoice_draft() from public, anon, authenticated;
grant execute on function public.create_invoice_draft() to authenticated;

create function public.update_invoice_draft_header(
  p_draft_id uuid, p_revision integer, p_supplier_id uuid, p_invoice_number text, p_invoice_date date
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_draft public.invoice_drafts%rowtype;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception 'Only an owner can edit invoice drafts' using errcode = '42501';
  end if;
  select * into v_draft from public.invoice_drafts where id = p_draft_id for update;
  if not found or v_draft.status <> 'ready' then
    raise exception 'Invoice draft is not ready' using errcode = '22023';
  end if;
  if v_draft.purchase_id is not null then
    raise exception 'Invoice was already approved' using errcode = 'CM413';
  end if;
  if v_draft.revision is distinct from p_revision then
    raise exception 'Invoice draft changed' using errcode = 'CM409';
  end if;
  update public.invoice_drafts set
    supplier_id = p_supplier_id,
    invoice_number = nullif(btrim(p_invoice_number), ''),
    invoice_date = p_invoice_date,
    flags = array_remove(flags, 'duplicate_invoice'),
    revision = revision + 1
  where id = p_draft_id returning revision into v_draft.revision;
  return v_draft.revision;
end;
$$;
revoke all on function public.update_invoice_draft_header(uuid, integer, uuid, text, date)
  from public, anon, authenticated;
grant execute on function public.update_invoice_draft_header(uuid, integer, uuid, text, date)
  to authenticated;

-- Account for starts, including failures and retries. The daily counter row
-- serializes quota claims across drafts.
create table public.invoice_extraction_quota (
  store_day date primary key,
  attempts integer not null check (attempts between 1 and 60)
);
alter table public.invoice_extraction_quota enable row level security;
revoke all on public.invoice_extraction_quota from public, anon, authenticated;

create function public.claim_invoice_extraction(p_draft_id uuid)
returns table (result text, attempt uuid, paths text[])
language plpgsql security definer set search_path = ''
as $$
declare
  v_draft public.invoice_drafts%rowtype;
  v_day date := (now() at time zone coalesce((select timezone from public.store_settings limit 1), 'Africa/Casablanca'))::date;
  v_paths text[];
  v_attempt uuid;
begin
  select * into v_draft from public.invoice_drafts where id = p_draft_id for update;
  if not found then
    return query select 'missing'::text, null::uuid, null::text[];
    return;
  end if;
  if v_draft.status = 'ready' then
    return query select 'ready'::text, null::uuid, null::text[];
    return;
  end if;
  if v_draft.status = 'extracting' and v_draft.extraction_started_at > now() - interval '3 minutes' then
    return query select 'busy'::text, null::uuid, null::text[];
    return;
  end if;

  select array_agg(name order by name) into v_paths
  from storage.objects where bucket_id = 'invoices' and name in (
    p_draft_id::text || '/1.jpg', p_draft_id::text || '/2.jpg', p_draft_id::text || '/3.jpg'
  );
  if v_paths is null or exists (
    select 1 from unnest(v_paths) with ordinality as p(path, page)
    where p.path <> p_draft_id::text || '/' || p.page || '.jpg'
  ) then
    return query select 'no_pages'::text, null::uuid, null::text[];
    return;
  end if;

  insert into public.invoice_extraction_quota (store_day, attempts) values (v_day, 1)
  on conflict (store_day) do update set attempts = invoice_extraction_quota.attempts + 1
  where invoice_extraction_quota.attempts < 60;
  if not found then
    return query select 'daily_limit'::text, null::uuid, null::text[];
    return;
  end if;

  v_attempt := gen_random_uuid();
  update public.invoice_drafts set status = 'extracting', extraction_error = null,
    photo_paths = v_paths, extraction_attempt = v_attempt, extraction_started_at = now()
  where id = p_draft_id;
  return query select 'claimed'::text, v_attempt, v_paths;
end;
$$;
revoke all on function public.claim_invoice_extraction(uuid) from public, anon, authenticated;
grant execute on function public.claim_invoice_extraction(uuid) to service_role;

create or replace function public.approve_invoice_draft(
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

  if v_draft.status <> 'ready' or v_draft.supplier_id is null or v_draft.invoice_number is null then
    raise exception 'A ready invoice needs a supplier and invoice number' using errcode = '22023';
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
