-- Webstore: change the app price of ONE product from the web link flow, as an
-- undoable batch (migration 058).
--
-- When the owner links a web product whose typed site price differs from the
-- app price and says "the site price is right", the app price used to change
-- with a plain UPDATE: no undo. apply_webstore_price makes it a batch with
-- source 'webstore' (percent 0, no category), reverted by the existing
-- undo_price_change_batch (migration 045), which works for any source: it only
-- restores products still at the price the batch gave them.
--
-- The price changes through UPDATE products only, so the existing triggers record
-- selling_price_history and bump updated_at.
--
-- Errors (SQLSTATE): 42501 not the owner, 22023 price missing or <= 0,
-- P0002 unknown product, 55000 inactive or Divers (misc) product.

alter table public.price_change_batches drop constraint price_change_batches_source_check;
alter table public.price_change_batches
  add constraint price_change_batches_source_check
  check (source in ('percent', 'competitor', 'webstore'));

-- Returns { "batch_id": uuid | null, "changed": 0 | 1 }; no batch when the
-- product already has this price.
create function public.apply_webstore_price(p_product_id uuid, p_price_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
  v_old bigint;
  v_kind text;
  v_active boolean;
begin
  if not public.is_owner() then
    raise exception 'only the owner can change prices' using errcode = '42501';
  end if;
  if p_product_id is null or p_price_cents is null or p_price_cents <= 0 then
    raise exception 'invalid price' using errcode = '22023';
  end if;

  select p.selling_price_cents, p.kind, p.active
    into v_old, v_kind, v_active
  from public.products p
  where p.id = p_product_id
  for update of p;
  if not found then
    raise exception 'product % does not exist', p_product_id using errcode = 'P0002';
  end if;
  if v_kind = 'misc' or not v_active then
    raise exception 'product % cannot be repriced from the webstore', p_product_id using errcode = '55000';
  end if;

  if v_old = p_price_cents then
    return jsonb_build_object('batch_id', null, 'changed', 0);
  end if;

  insert into public.price_change_batches (category_id, percent, source, product_count)
  values (null, 0, 'webstore', 1)
  returning id into v_batch;

  update public.products
  set selling_price_cents = p_price_cents
  where id = p_product_id;

  insert into public.price_change_items (batch_id, product_id, old_price_cents, new_price_cents)
  values (v_batch, p_product_id, v_old, p_price_cents);

  insert into public.activity_log (actor_id, action, entity_id, details)
  values (auth.uid(), 'webstore_price_apply', v_batch, jsonb_build_object('product_count', 1));
  return jsonb_build_object('batch_id', v_batch, 'changed', 1);
end;
$$;

revoke execute on function public.apply_webstore_price(uuid, bigint) from public, anon;
grant execute on function public.apply_webstore_price(uuid, bigint) to authenticated;
