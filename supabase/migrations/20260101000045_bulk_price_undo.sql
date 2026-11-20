-- Undo a bulk price change (UX_REVIEW O1, remaining part).
--
-- bulk_adjust_selling_price now also records WHAT it changed: one batch row
-- (who, when, which category, how many percent) and one item per product whose
-- price actually moved (old and new price). undo_price_change_batch puts the
-- old prices back, but only for products still at the price the batch gave
-- them: a product the owner edited since keeps its newer price and is counted
-- as skipped.
--
-- Side effects of a price change are reused, not copied: both functions only
-- UPDATE products.selling_price_cents, so the existing triggers do the rest
-- (selling_price_history row from migration 027, which Sell's price review and
-- the price history screen read; products.updated_at, which the Sell cache
-- uses to pick up changes). The activity log gets one row per change and one
-- per undo.
--
-- Behaviour change: bulk_adjust_selling_price used to be security invoker (a
-- cashier's call updated zero rows through RLS). It must now write the batch
-- tables, so it is security definer and refuses a non-owner explicitly with
-- 42501. For the owner the effect and the return value (number of products in
-- scope) are unchanged.
--
-- Errors of undo_price_change_batch (SQLSTATE):
--   42501  not the owner
--   P0002  no such batch
--   55000  the batch was already undone

create table public.price_change_batches (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid not null default auth.uid() references public.profiles (id),
  created_at    timestamptz not null default now(),
  -- null = every active product. Deliberately not a foreign key: the record
  -- must outlive the category.
  category_id   uuid,
  percent       numeric not null,
  product_count integer not null default 0,
  reverted_at   timestamptz,
  reverted_by   uuid references public.profiles (id)
);
create index idx_price_change_batches_created on public.price_change_batches (created_at desc);

create table public.price_change_items (
  batch_id        uuid not null references public.price_change_batches (id) on delete cascade,
  product_id      uuid not null references public.products (id) on delete cascade,
  old_price_cents bigint not null check (old_price_cents >= 0),
  new_price_cents bigint not null check (new_price_cents >= 0),
  primary key (batch_id, product_id)
);

alter table public.price_change_batches enable row level security;
alter table public.price_change_items enable row level security;

create policy "owner reads price change batches" on public.price_change_batches
  for select using (public.is_owner());
create policy "owner reads price change items" on public.price_change_items
  for select using (public.is_owner());

-- Clients only read; every write goes through the two functions below.
revoke all on public.price_change_batches, public.price_change_items from anon, authenticated;
grant select on public.price_change_batches, public.price_change_items to authenticated;

-------------------------------------------------------------------------------
-- bulk_adjust_selling_price: same signature, same percent rule and scope as
-- migration 036 (the category and its sub-categories, active products), now
-- recording the batch.
-------------------------------------------------------------------------------
create or replace function public.bulk_adjust_selling_price(p_category_id uuid, p_percent numeric)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_changed integer;
  v_batch uuid;
begin
  if not public.is_owner() then
    raise exception 'only the owner can change prices in bulk' using errcode = '42501';
  end if;

  insert into public.price_change_batches (category_id, percent)
  values (p_category_id, p_percent)
  returning id into v_batch;

  with target as (
    select p.id,
           p.selling_price_cents as old_cents,
           greatest(0, round(p.selling_price_cents * (1 + p_percent / 100.0)))::bigint as new_cents
    from public.products p
    where (
        p_category_id is null
        or p.category_id = p_category_id
        or p.category_id in (select c.id from public.categories c where c.parent_id = p_category_id)
      )
      and p.active
    for update of p
  ),
  upd as (
    update public.products p
    set selling_price_cents = t.new_cents
    from target t
    where p.id = t.id
    returning p.id, t.old_cents, t.new_cents
  ),
  ins as (
    insert into public.price_change_items (batch_id, product_id, old_price_cents, new_price_cents)
    select v_batch, id, old_cents, new_cents from upd where new_cents <> old_cents
    returning 1
  )
  select (select count(*) from upd), (select count(*) from ins)
  into v_count, v_changed;

  if v_changed = 0 then
    -- Nothing moved: no batch to undo.
    delete from public.price_change_batches where id = v_batch;
  else
    update public.price_change_batches set product_count = v_changed where id = v_batch;
    insert into public.activity_log (actor_id, action, entity_id, details)
    values (
      auth.uid(),
      'bulk_price_change',
      v_batch,
      jsonb_build_object(
        'category_id', p_category_id,
        'percent', p_percent,
        'product_count', v_changed
      )
    );
  end if;

  return v_count;
end;
$$;

-------------------------------------------------------------------------------
-- undo_price_change_batch
-------------------------------------------------------------------------------
create function public.undo_price_change_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.price_change_batches;
  v_total integer;
  v_restored integer;
begin
  if not public.is_owner() then
    raise exception 'only the owner can undo a price change' using errcode = '42501';
  end if;

  select * into v_batch from public.price_change_batches where id = p_batch_id for update;
  if not found then
    raise exception 'price change % does not exist', p_batch_id using errcode = 'P0002';
  end if;
  if v_batch.reverted_at is not null then
    raise exception 'price change % was already undone', p_batch_id using errcode = '55000';
  end if;

  select count(*) into v_total from public.price_change_items where batch_id = p_batch_id;

  with upd as (
    update public.products p
    set selling_price_cents = i.old_price_cents
    from public.price_change_items i
    where i.batch_id = p_batch_id
      and p.id = i.product_id
      -- Only if nobody changed the price since this batch.
      and p.selling_price_cents = i.new_price_cents
    returning 1
  )
  select count(*) into v_restored from upd;

  update public.price_change_batches
  set reverted_at = now(), reverted_by = auth.uid()
  where id = p_batch_id;

  insert into public.activity_log (actor_id, action, entity_id, details)
  values (
    auth.uid(),
    'bulk_price_undo',
    p_batch_id,
    jsonb_build_object('restored', v_restored, 'skipped', v_total - v_restored)
  );

  return jsonb_build_object('restored', v_restored, 'skipped', v_total - v_restored);
end;
$$;

revoke execute on function public.bulk_adjust_selling_price(uuid, numeric) from public, anon;
grant execute on function public.bulk_adjust_selling_price(uuid, numeric) to authenticated;
revoke execute on function public.undo_price_change_batch(uuid) from public, anon;
grant execute on function public.undo_price_change_batch(uuid) to authenticated;
