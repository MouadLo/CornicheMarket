-- Invoice scanning, part 3: per-supplier product aliases, pack sizes,
-- delivery dated from the invoice, duplicates checked against purchases.
--
-- Error codes (in addition to 031/033: CM409, CM412, CM413, 22023, 23505):
-- CM414: the invoice date is in the future (fix the header before approving).
--
-- The model never chooses products. match_invoice_lines suggests them from the
-- owner's own past approvals (exact alias) or by name similarity (candidates
-- only). The owner confirms every line; approval then records the alias.

-- 1. Aliases: what a supplier prints for a line -> our product, and how many
--    stock units one billed unit holds (1 carton = 12 pieces).
create function public.invoice_alias_key(p_text text) returns text
language sql immutable parallel safe set search_path = ''
as $$ select lower(regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g')) $$;

create table public.supplier_product_aliases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  alias_key text not null check (alias_key <> '' and length(alias_key) <= 300),
  billing_unit_key text not null default '' check (length(billing_unit_key) <= 100),
  product_id uuid not null references public.products (id) on delete cascade,
  units_per_billing_unit integer not null default 1 check (units_per_billing_unit between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, alias_key, billing_unit_key)
);

alter table public.supplier_product_aliases enable row level security;
revoke all on public.supplier_product_aliases from public, anon, authenticated;
grant select on public.supplier_product_aliases to authenticated;
create policy "owner reads supplier aliases" on public.supplier_product_aliases
  for select to authenticated using ((select public.is_owner()));

-- Share of the invoice wording's words found in a product name. Words of 3+
-- characters, small French link words ignored; a 4+ letter word also matches
-- its plural or a longer form (pomme ~ pommes). Trigram similarity alone
-- ranks "Pommes de terre" above "Jus Pomme" for "Jus de pomme 25cl".
create function public.invoice_word_overlap(p_wording text, p_name text) returns real
language sql immutable parallel safe set search_path = ''
as $$
  with w as (
    select distinct word from regexp_split_to_table(lower(coalesce(p_wording, '')), '[^[:alnum:]]+') word
    where length(word) >= 3 and word not in ('les', 'des', 'aux', 'pour', 'avec', 'sans')
  ), n as (
    select distinct word from regexp_split_to_table(lower(coalesce(p_name, '')), '[^[:alnum:]]+') word
    where length(word) >= 2
  )
  select coalesce(
    (select count(*) filter (where exists (
       select 1 from n where n.word = w.word
         or (length(w.word) >= 4 and length(n.word) >= 4
             and (n.word like w.word || '%' or w.word like n.word || '%'))
     ))::real / nullif(count(*), 0) from w),
    0)
$$;

-- 2. Suggestions for every line of a draft. One row per suggestion:
--    exact = true is the owner's own earlier choice for this supplier and
--    wording; otherwise up to three products whose names share words with it.
create function public.match_invoice_lines(p_draft_id uuid)
returns table (
  line_index integer,
  product_id uuid,
  product_name text,
  product_unit public.product_unit,
  units_per_billing_unit integer,
  exact boolean,
  score real
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_draft public.invoice_drafts%rowtype;
  v_line jsonb;
  v_index integer;
  v_key text;
  v_found boolean;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception 'Only an owner can match invoice lines' using errcode = '42501';
  end if;
  select * into v_draft from public.invoice_drafts where id = p_draft_id;
  if not found then
    raise exception 'Invoice draft not found' using errcode = '22023';
  end if;

  for v_line, v_index in
    select value, ordinality::integer - 1 from jsonb_array_elements(v_draft.source_lines) with ordinality
  loop
    v_key := public.invoice_alias_key(v_line ->> 'description');
    continue when v_key = '';
    v_found := false;

    if v_draft.supplier_id is not null then
      return query
        select v_index, p.id, p.name, p.unit, a.units_per_billing_unit, true, 1::real
        from public.supplier_product_aliases a
        join public.products p on p.id = a.product_id
        where a.supplier_id = v_draft.supplier_id
          and a.alias_key = v_key
          and a.billing_unit_key = public.invoice_alias_key(v_line ->> 'billing_unit')
          and p.active and p.kind = 'regular';
      v_found := found;
    end if;

    if not v_found then
      return query
        select v_index, p.id, p.name, p.unit, null::integer, false, m.score
        from public.products p
        cross join lateral (
          select public.invoice_word_overlap(v_key, p.name) as overlap,
                 public.similarity(lower(p.name), v_key) as trigram
        ) o
        cross join lateral (select (0.7 * o.overlap + 0.3 * o.trigram)::real as score) m
        where p.active and p.kind = 'regular' and o.overlap > 0 and m.score >= 0.25
        order by m.score desc, p.name
        limit 3;
    end if;
  end loop;
end;
$$;
revoke all on function public.match_invoice_lines(uuid) from public, anon, authenticated;
grant execute on function public.match_invoice_lines(uuid) to authenticated;

-- 3. Duplicates: also against saved deliveries. An approved invoice stores its
--    number as the purchase note, and the owner may have typed it there for a
--    manual delivery. Recomputed whenever the supplier or number changes.
create function public.invoice_drafts_check_duplicate() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.purchase_id is not null or new.status <> 'ready' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.supplier_id is not distinct from old.supplier_id
     and new.invoice_number is not distinct from old.invoice_number
     and new.status is not distinct from old.status then
    return new;
  end if;
  -- Extraction blanks the number of a draft that repeats another draft and
  -- flags it; keep that flag until the owner enters a number.
  if new.supplier_id is null or new.invoice_number is null then
    return new;
  end if;
  new.flags := array_remove(new.flags, 'duplicate_invoice');
  if exists (
    select 1 from public.purchases p
    where p.supplier_id = new.supplier_id
      and p.voided_at is null
      and lower(btrim(p.notes)) = lower(btrim(new.invoice_number))
  ) then
    new.flags := array_append(new.flags, 'duplicate_invoice');
  end if;
  return new;
end;
$$;
revoke all on function public.invoice_drafts_check_duplicate() from public, anon, authenticated;

create trigger trg_invoice_drafts_check_duplicate
  before insert or update on public.invoice_drafts
  for each row execute function public.invoice_drafts_check_duplicate();

-- 4. Header edits: a future date is refused here, before approval.
create or replace function public.update_invoice_draft_header(
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
  if p_invoice_date > (now() at time zone coalesce((select s.timezone from public.store_settings s limit 1), 'Africa/Casablanca'))::date then
    raise exception 'The invoice date is in the future' using errcode = 'CM414';
  end if;
  -- The duplicate flag is recomputed by trg_invoice_drafts_check_duplicate.
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

-- 5. Approval: delivery dated from the invoice, aliases recorded.
--    Each reviewed line may carry units_per_billing_unit (default 1); the
--    client has already converted quantity and unit cost into stock units.
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
  v_index integer;
  v_source jsonb;
  v_new jsonb;
  v_product_id uuid;
  v_unit public.product_unit;
  v_quantity numeric;
  v_selling_price numeric;
  v_name text;
  v_units numeric;
  v_alias text;
  v_receive_lines jsonb := '[]'::jsonb;
  v_aliases jsonb := '[]'::jsonb;
  v_today date;
  v_delivery_date date;
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

  -- Stock arrives on the invoice date when it is recent; receive_delivery
  -- cannot backdate more than 60 days, so an older invoice is received today.
  v_today := (now() at time zone coalesce((select s.timezone from public.store_settings s limit 1), 'Africa/Casablanca'))::date;
  if v_draft.invoice_date > v_today then
    raise exception 'The invoice date is in the future' using errcode = 'CM414';
  end if;
  v_delivery_date := case when v_draft.invoice_date >= v_today - 60 then v_draft.invoice_date end;

  if jsonb_typeof(p_review_lines) is distinct from 'array' then
    raise exception 'Reviewed lines must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_review_lines) not between 1 and 500
    or jsonb_array_length(p_review_lines) <> jsonb_array_length(v_draft.source_lines) then
    raise exception 'Review every invoice line before approving' using errcode = '22023';
  end if;

  for v_line, v_index in
    select value, ordinality::integer - 1 from jsonb_array_elements(p_review_lines) with ordinality
  loop
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

    v_units := 1;
    if v_line ? 'units_per_billing_unit' and jsonb_typeof(v_line -> 'units_per_billing_unit') <> 'null' then
      if jsonb_typeof(v_line -> 'units_per_billing_unit') <> 'number' then
        raise exception 'Invalid units per billing unit' using errcode = '22023';
      end if;
      v_units := (v_line ->> 'units_per_billing_unit')::numeric;
      if v_units not between 1 and 10000 or v_units <> trunc(v_units) then
        raise exception 'Invalid units per billing unit' using errcode = '22023';
      end if;
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
      where id = v_product_id and active and unit = v_unit and kind = 'regular'
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

    -- The alias is keyed on what the invoice printed (from the draft, never
    -- from the client), so the next invoice from this supplier pre-fills.
    v_source := v_draft.source_lines -> v_index;
    v_alias := public.invoice_alias_key(v_source ->> 'description');
    if v_alias <> '' and length(v_alias) <= 300 then
      v_aliases := v_aliases || jsonb_build_array(jsonb_build_object(
        'alias_key', v_alias,
        'billing_unit_key', left(public.invoice_alias_key(v_source ->> 'billing_unit'), 100),
        'product_id', v_product_id,
        'units', v_units
      ));
    end if;
  end loop;

  v_purchase_id := public.receive_delivery(
    v_draft.id, v_draft.supplier_id, v_draft.invoice_number, v_receive_lines, '[]'::jsonb, v_delivery_date
  );

  -- When the same wording appears twice on one invoice, the last line wins.
  insert into public.supplier_product_aliases
    (supplier_id, alias_key, billing_unit_key, product_id, units_per_billing_unit)
  select distinct on (a ->> 'alias_key', a ->> 'billing_unit_key')
    v_draft.supplier_id, a ->> 'alias_key', a ->> 'billing_unit_key',
    (a ->> 'product_id')::uuid, (a ->> 'units')::integer
  from jsonb_array_elements(v_aliases) with ordinality as l(a, position)
  order by a ->> 'alias_key', a ->> 'billing_unit_key', position desc
  on conflict (supplier_id, alias_key, billing_unit_key) do update set
    product_id = excluded.product_id,
    units_per_billing_unit = excluded.units_per_billing_unit,
    updated_at = now();

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
