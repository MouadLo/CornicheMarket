-- Sub-categories, one level deep: a category may have a parent, and a parent
-- may not have one itself. A product sits in a main category or in one of its
-- sub-categories. Additive: existing categories stay main categories.
alter table public.categories
  add column parent_id uuid references public.categories (id) on delete restrict;

alter table public.categories
  add constraint categories_not_own_parent check (parent_id is null or parent_id <> id);

create index categories_parent_idx on public.categories (parent_id) where parent_id is not null;

create function public.check_category_depth()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is null then
    return new;
  end if;
  if exists (select 1 from public.categories where id = new.parent_id and parent_id is not null) then
    raise exception 'A sub-category cannot have sub-categories' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.categories where parent_id = new.id) then
    raise exception 'A category with sub-categories cannot become a sub-category'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_category_depth() from public, anon, authenticated;

create trigger trg_categories_depth
  before insert or update of parent_id on public.categories
  for each row execute function public.check_category_depth();

-- Only main categories have a Sell tab; a sub-category's products show in its
-- parent's tab. Replaces the insert-only trigger from migration 029.
create or replace function public.add_grid_tab_for_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_id is not null then
    delete from public.sell_grid_tabs where category_id = new.id;
  elsif not exists (select 1 from public.sell_grid_tabs where category_id = new.id) then
    insert into public.sell_grid_tabs (kind, category_id, position)
    values (
      'category',
      new.id,
      coalesce((select max(position) from public.sell_grid_tabs), 0) + 1
    );
  end if;
  return new;
end;
$$;

create trigger trg_categories_regrid_tab
  after update of parent_id on public.categories
  for each row
  when (old.parent_id is distinct from new.parent_id)
  execute function public.add_grid_tab_for_category();

-- A main category's price change includes its sub-categories.
create or replace function public.bulk_adjust_selling_price(p_category_id uuid, p_percent numeric)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  update products
  set selling_price_cents = greatest(0, round(selling_price_cents * (1 + p_percent / 100.0)))
  where (
      p_category_id is null
      or category_id = p_category_id
      or category_id in (select id from categories where parent_id = p_category_id)
    )
    and active;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Report by main category: sub-category sales roll up into their parent.
create or replace function public.report_by_category(p_from timestamptz, p_to timestamptz)
returns table (
  category_id uuid,
  category_name text,
  quantity numeric,
  revenue_cents bigint,
  profit_cents bigint
)
language plpgsql
stable
as $$
begin
  if not public.is_owner() then
    raise exception 'Reports are owner only';
  end if;

  return query
  select
    coalesce(top.id, p.category_id),
    coalesce(top.name, 'Uncategorised') as category_name,
    coalesce(sum(e.quantity), 0),
    coalesce(sum(e.net_revenue_cents), 0)::bigint,
    coalesce(sum(e.net_revenue_cents - e.cost_cents), 0)::bigint
  from sale_line_economics e
  join products p on p.id = e.product_id
  left join categories c on c.id = p.category_id
  left join categories top on top.id = coalesce(c.parent_id, c.id)
  where e.occurred_at >= p_from and e.occurred_at < p_to
  group by coalesce(top.id, p.category_id), top.name
  order by 4 desc;
end;
$$;
