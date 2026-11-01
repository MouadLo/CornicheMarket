-- Sell grid, step 1 (docs/SELL-GRID-DESIGN.md 2.5): the layout tables only.
-- One grid per store, the same on every device. Tabs are Favoris (hand-picked)
-- plus one auto-filled tab per category; tiles are the owner's overrides
-- (hide, pin, order) on a category tab, or the picks on Favoris. No cost data
-- lives here: tiles read name, price and unit from the cashier-safe product
-- cache. Divers and the pads come in later steps.

create table public.sell_grid_tabs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('favorites', 'category')),
  category_id uuid references public.categories (id) on delete cascade,
  label       text,                                   -- null = category name / "Favoris"
  position    integer not null,
  visible     boolean not null default true,
  auto_fill   boolean not null default true,          -- category tabs auto-fill (decision 5)
  updated_at  timestamptz not null default now(),
  constraint tab_kind_matches_category
    check ((kind = 'category') = (category_id is not null)),
  constraint favorites_never_auto_fill
    check (kind = 'category' or auto_fill = false)
);
create unique index sell_grid_one_favorites on public.sell_grid_tabs (kind) where kind = 'favorites';
create unique index sell_grid_one_tab_per_category on public.sell_grid_tabs (category_id) where category_id is not null;

-- On Favoris a row means "this product is on the tab". On an auto-filled
-- category tab a row is an OVERRIDE of the automatic list (hide, pin, position).
create table public.sell_grid_tiles (
  id          uuid primary key default gen_random_uuid(),
  tab_id      uuid not null references public.sell_grid_tabs (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  position    integer not null,
  hidden      boolean not null default false,
  pinned      boolean not null default false,
  color       text check (color in ('green','teal','blue','indigo','purple','red','amber','grey')),
  short_label text check (char_length(short_label) <= 24),
  unique (tab_id, product_id)
);

alter table public.sell_grid_tabs enable row level security;
alter table public.sell_grid_tiles enable row level security;

-- Everyone signed in reads (no cost columns exist here); only the owner writes.
create policy "authenticated reads grid tabs" on public.sell_grid_tabs
  for select using (auth.role() = 'authenticated');
create policy "owner writes grid tabs" on public.sell_grid_tabs
  for all using (public.is_owner()) with check (public.is_owner());
create policy "authenticated reads grid tiles" on public.sell_grid_tiles
  for select using (auth.role() = 'authenticated');
create policy "owner writes grid tiles" on public.sell_grid_tiles
  for all using (public.is_owner()) with check (public.is_owner());

-- Privileges (the pattern of migration 026): nothing for anon; clients read, and
-- write only through RLS (owner), never TRUNCATE.
revoke all on public.sell_grid_tabs, public.sell_grid_tiles from anon, authenticated;
grant select, insert, update, delete on public.sell_grid_tabs, public.sell_grid_tiles to authenticated;

-- Out of the box the grid works: Favoris first (empty until the owner picks
-- products, and hidden while empty), then one auto-filled tab per category.
insert into public.sell_grid_tabs (kind, position, auto_fill) values ('favorites', 0, false);
insert into public.sell_grid_tabs (kind, category_id, position)
select 'category', id, row_number() over (order by name) from public.categories;

-- A new category gets its tab at the end, so its products show up with no setup.
create function public.add_grid_tab_for_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sell_grid_tabs (kind, category_id, position)
  values (
    'category',
    new.id,
    coalesce((select max(position) from public.sell_grid_tabs), 0) + 1
  );
  return new;
end;
$$;
revoke execute on function public.add_grid_tab_for_category() from public, anon, authenticated;

create trigger trg_categories_add_grid_tab
  after insert on public.categories
  for each row execute function public.add_grid_tab_for_category();
