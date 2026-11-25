-- Webstore photos. A web product can now show one of two pictures, and the owner
-- chooses which: the image link (image_url, as before) or a file uploaded for the
-- site (image_path, in the public 'webstore-images' bucket). Choosing one never
-- deletes the other. The app's own product photo (private bucket, migration 053)
-- is never modified: using it for the site copies the file into this bucket.
--
-- The bucket is public on purpose: the site's visitors load the pictures without
-- signing in: public buckets serve reads without any policy. Only the owner may
-- write. The owner also needs a select policy: Storage looks an object up before it
-- replaces, deletes or copies it (without it those calls fail with "not found").
-- Nothing for anon.

-------------------------------------------------------------------------------
-- 1. Columns
-------------------------------------------------------------------------------
alter table public.web_products
  add column image_path text
    check (image_path is null or image_path ~ '^[A-Za-z0-9_-]{1,20}/[A-Za-z0-9._-]{1,80}$'),
  add column image_source text not null default 'url'
    check (image_source in ('url', 'file')),
  add constraint web_products_file_needs_path
    check (image_source = 'url' or image_path is not null);

-------------------------------------------------------------------------------
-- 2. Storage: public bucket, written by the owner only
-------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('webstore-images', 'webstore-images', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp']);

-- Object path convention: <web product id>/<timestamp>.jpg
create policy "owner reads webstore images" on storage.objects
  for select to authenticated
  using (bucket_id = 'webstore-images' and (select public.is_owner()));

create policy "owner uploads webstore images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'webstore-images' and (select public.is_owner()));

create policy "owner replaces webstore images" on storage.objects
  for update to authenticated
  using (bucket_id = 'webstore-images' and (select public.is_owner()))
  with check (bucket_id = 'webstore-images' and (select public.is_owner()));

create policy "owner deletes webstore images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'webstore-images' and (select public.is_owner()));

-------------------------------------------------------------------------------
-- 3. The feed: `image` is the chosen picture. A file is given as a path relative
-- to the project (SQL does not know the project URL); the edge function
-- 'webstore-feed' prefixes it. Body otherwise identical to migration 055.
-------------------------------------------------------------------------------
create or replace function public.webstore_feed()
returns jsonb
language plpgsql
security definer set search_path = public
stable
as $$
declare
  v_result jsonb;
begin
  if not (auth.role() = 'service_role' or public.is_owner()) then
    raise exception 'owner only' using errcode = '42501';
  end if;

  with feed_products as (
    select
      wp.id, wp.name, wp.name_fr, wp.size, wp.category_id, wp.sub_code,
      wp.popular, wp.keywords, wp.image_url, wp.image_path, wp.image_source, wp.sort,
      case when wp.product_id is null then wp.price_cents else p.selling_price_cents end as cents,
      case when wp.stock_mode = 'auto' then p.stock_quantity > 0 else wp.manual_in_stock end as in_stock
    from public.web_products wp
    join public.web_categories c on c.id = wp.category_id
    left join public.products p on p.id = wp.product_id
    where wp.published
      and (wp.product_id is null or (p.active and p.kind <> 'misc'))
  ),
  feed_subs as (
    select s.category_id, s.code, s.name, s.name_fr, s.sort
    from public.web_subcategories s
    where exists (
      select 1 from feed_products fp where fp.category_id = s.category_id and fp.sub_code = s.code
    )
  ),
  feed_categories as (
    select c.id, c.name, c.name_fr, c.icon, c.sort,
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', s.code, 'name', s.name, 'name_fr', s.name_fr)
          order by s.sort, s.code)
        from feed_subs s where s.category_id = c.id
      ), '[]'::jsonb) as subs
    from public.web_categories c
    where exists (select 1 from feed_products fp where fp.category_id = c.id)
  ),
  feed_kits as (
    select k.id, k.name, k.name_fr, k.sort
    from public.web_kits k
    where k.published and exists (select 1 from public.web_kit_items i where i.kit_id = k.id)
    order by k.sort, k.id
    limit 20
  )
  select jsonb_build_object(
    'version', (select version from public.webstore_state),
    'generated_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', c.id, 'name', c.name, 'name_fr', c.name_fr, 'icon', c.icon, 'subs', c.subs)
        order by c.sort, c.id)
      from feed_categories c
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', fp.id,
          'name', fp.name,
          'name_fr', nullif(fp.name_fr, ''),
          'size', nullif(fp.size, ''),
          'cat', fp.category_id,
          'sub', fp.sub_code,
          'price', case when fp.cents is null then null else trim_scale(round(fp.cents / 100.0, 2)) end,
          'stock', fp.in_stock,
          'popular', fp.popular,
          'image', case
            when fp.image_source = 'file' and fp.image_path is not null
              then '/storage/v1/object/public/webstore-images/' || fp.image_path
            else nullif(fp.image_url, '')
          end,
          'keywords', nullif(fp.keywords, ''))
        order by fp.sort, fp.id)
      from feed_products fp
    ), '[]'::jsonb),
    'kits', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', k.id,
          'name', k.name,
          'name_fr', nullif(k.name_fr, ''),
          'items', (
            select coalesce(jsonb_agg(jsonb_build_object('id', i.web_product_id, 'qty', i.qty)
                                      order by i.sort, i.web_product_id), '[]'::jsonb)
            from (
              select * from public.web_kit_items ki where ki.kit_id = k.id
              order by ki.sort, ki.web_product_id limit 12
            ) i
          ))
        order by k.sort, k.id)
      from feed_kits k
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;
