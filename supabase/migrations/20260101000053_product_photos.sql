-- Product photos (one per product). The photo is a file in the private
-- 'product-photos' bucket; products only remember its path. Cashiers see photos
-- (to recognise products faster on the Sell screen), only the owner changes
-- them. Photos are never shown to customers (receipts, the loyalty card page).

alter table public.products
  add column photo_path text,
  add column photo_updated_at timestamptz;

-- No direct column grant: the photo is set only through set_product_photo /
-- clear_product_photo below, which check the path and return the old file.

-- Cashiers read products only through this view. A photo path is not cost data.
-- create or replace view can only append columns, so the new ones go last.
create or replace view public.products_cashier_view as
select
  id, name, barcode, category_id, unit,
  selling_price_cents, stock_quantity, low_stock_threshold, active,
  created_at, updated_at, is_low_stock,
  kind, track_stock,
  public.discountable(products) as discountable,
  loyalty_excluded, loyalty_bonus_points, loyalty_bonus_until,
  photo_path, photo_updated_at
from public.products;

-------------------------------------------------------------------------------
-- Storage: private bucket, readable by active staff, written by the owner only.
-------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', false, 2097152,
        array['image/jpeg', 'image/png', 'image/webp']);

-- An owner or a cashier whose account is not deactivated (migration 040).
create function public.is_active_staff()
returns boolean
language sql
security definer set search_path = ''
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and deactivated_at is null
  );
$$;
revoke all on function public.is_active_staff() from public, anon;
grant execute on function public.is_active_staff() to authenticated, service_role;

create policy "staff read product photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'product-photos' and (select public.is_active_staff()));

-- Object path convention: <product_id>/<uuid>.<jpg|png|webp>.
create policy "owner uploads product photos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-photos' and (select public.is_owner())
    and exists (
      select 1 from public.products p where p.id::text = (storage.foldername(objects.name))[1]
    )
  );

create policy "owner replaces product photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-photos' and (select public.is_owner()))
  with check (bucket_id = 'product-photos' and (select public.is_owner()));

create policy "owner deletes product photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-photos' and (select public.is_owner()));

-------------------------------------------------------------------------------
-- set_product_photo / clear_product_photo: owner only. Both return the previous
-- path (or null) so the caller can delete the old file.
-------------------------------------------------------------------------------
create function public.set_product_photo(p_product_id uuid, p_path text)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  v_old text;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception 'Only an owner can change product photos' using errcode = '42501';
  end if;
  if p_path is null
     or p_path !~ ('^' || p_product_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$') then
    raise exception 'Invalid photo path' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects where bucket_id = 'product-photos' and name = p_path
  ) then
    raise exception 'Photo file not found' using errcode = '22023';
  end if;

  select photo_path into v_old from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Unknown product' using errcode = '22023';
  end if;

  update public.products
     set photo_path = p_path, photo_updated_at = now()
   where id = p_product_id;
  return case when v_old is distinct from p_path then v_old end;
end;
$$;
revoke all on function public.set_product_photo(uuid, text) from public, anon;
grant execute on function public.set_product_photo(uuid, text) to authenticated;

create function public.clear_product_photo(p_product_id uuid)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  v_old text;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception 'Only an owner can change product photos' using errcode = '42501';
  end if;
  select photo_path into v_old from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Unknown product' using errcode = '22023';
  end if;
  update public.products
     set photo_path = null, photo_updated_at = now()
   where id = p_product_id;
  return v_old;
end;
$$;
revoke all on function public.clear_product_photo(uuid) from public, anon;
grant execute on function public.clear_product_photo(uuid) to authenticated;
