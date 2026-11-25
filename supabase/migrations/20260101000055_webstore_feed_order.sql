-- Webstore feed: products keep the owner's own order (their `sort`), across
-- categories, like the Google Sheet the page read before. Migration 054 sorted
-- by category first, which moved the phone accessories (first in the sheet)
-- below the drinks in the page's "all products" view. Body otherwise unchanged.
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
      wp.popular, wp.keywords, wp.image_url, wp.sort,
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
          'image', nullif(fp.image_url, ''),
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
