-- Competitor opportunities (migration 061).
--
-- 1. products.price_check: "produit repère", a product customers know the price
--    of. The owner tags it by hand; the app then keeps it level with the
--    competitor. Owner-only: the products policy is "for all ... is_owner()" and
--    the column grant below is the only way to write it. It is NOT added to
--    products_cashier_view.
-- 2. competitor_price_overview() gets two more columns, price_check and
--    sold_30d (units sold in the last 30 days, from product_sales_30d), which
--    feed the "Opportunités" tab. Same body, security and grants as migration 051.

alter table public.products
  add column price_check boolean not null default false;

grant update (price_check) on public.products to authenticated;

-- The column list of a function result cannot change in place.
drop function public.competitor_price_overview(uuid);

create function public.competitor_price_overview(p_product_id uuid default null)
returns table (
  product_id           uuid,
  product_name         text,
  unit                 public.product_unit,
  selling_price_cents  bigint,
  cost_cents           bigint,
  min_margin_percent   numeric,
  margin_override      numeric,
  link_id              uuid,
  shop_name            text,
  url                  text,
  mode                 text,
  last_status          text,
  last_status_detail   text,
  last_checked_at      timestamptz,
  last_ok_at           timestamptz,
  price_cents          bigint,
  regular_price_cents  bigint,
  on_sale              boolean,
  in_stock             boolean,
  low_stock_remaining  integer,
  title                text,
  image_url            text,
  observed_at          timestamptz,
  price_check          boolean,
  sold_30d             numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'only the owner can read competitor prices' using errcode = '42501';
  end if;

  return query
  select p.id, p.name, p.unit, p.selling_price_cents, p.current_cost_cents,
         coalesce(f.min_margin_percent, s.competitor_min_margin_percent),
         f.min_margin_percent,
         l.id, l.shop_name, l.url, l.mode, l.last_status, l.last_status_detail,
         l.last_checked_at, l.last_ok_at,
         pt.price_cents, pt.regular_price_cents, pt.on_sale, pt.in_stock,
         pt.low_stock_remaining, pt.title, pt.image_url, pt.observed_at,
         p.price_check,
         coalesce(sv.quantity_sold, 0)::numeric
  from public.competitor_links l
  join public.products p on p.id = l.product_id
  cross join (select competitor_min_margin_percent from public.owner_settings where singleton) s
  left join public.product_margin_floors f on f.product_id = p.id
  left join public.product_sales_30d sv on sv.product_id = p.id
  left join lateral (
    select x.price_cents, x.regular_price_cents, x.on_sale, x.in_stock,
           x.low_stock_remaining, x.title, x.image_url, x.observed_at
    from public.competitor_price_points x
    where x.link_id = l.id
    order by x.observed_at desc, x.id desc
    limit 1
  ) pt on true
  where case when p_product_id is null then p.active else p.id = p_product_id end
  order by p.name, l.created_at;
end;
$$;

revoke execute on function public.competitor_price_overview(uuid) from public, anon;
grant execute on function public.competitor_price_overview(uuid) to authenticated;
