-- Arrange the Sell grid (UX_REVIEW O7): the owner drags tabs and tiles into
-- order and hides some, and the whole arrangement is saved in ONE call, so a
-- half-saved grid can never be seen on another device.
--
--   p_tabs  : [{ "id": uuid, "position": int, "visible": bool }]
--   p_tiles : [{ "tab_id": uuid, "product_id": uuid, "position": int, "hidden": bool }]
--             the full ordered list of each tab being arranged
--
-- Tabs are updated (position, visible). Tiles are upserted on (tab_id, product_id)
-- setting ONLY position and hidden: an existing row keeps its colour, short
-- label and pinned flag. On a category tab a row is an override of the automatic
-- list, so ordering a tab gives every product of the payload an explicit position
-- (a hidden one a hidden row); a product added to the category later has no row
-- and Sell appends it after the placed ones, alphabetically (resolveGrid).
--
-- Errors (SQLSTATE):
--   42501  not the owner
--   22023  malformed payload, or the same tab/product twice
--   P0002  a tab in the payload does not exist
--   23514  a product that does not belong on its tab, or no visible tab left
create function public.save_sell_grid_arrangement(p_tabs jsonb, p_tiles jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_tab public.sell_grid_tabs;
begin
  if not public.is_owner() then
    raise exception 'only the owner can arrange the sell grid' using errcode = '42501';
  end if;
  if p_tabs is null or jsonb_typeof(p_tabs) <> 'array'
     or p_tiles is null or jsonb_typeof(p_tiles) <> 'array' then
    raise exception 'tabs and tiles must be arrays' using errcode = '22023';
  end if;

  -- Tabs.
  if (select count(*) <> count(distinct e ->> 'id') from jsonb_array_elements(p_tabs) e) then
    raise exception 'a tab appears twice' using errcode = '22023';
  end if;
  for v_row in
    select (e ->> 'id')::uuid as id,
           (e ->> 'position')::integer as position,
           (e ->> 'visible')::boolean as visible
    from jsonb_array_elements(p_tabs) e
  loop
    if v_row.id is null or v_row.position is null or v_row.visible is null then
      raise exception 'a tab needs id, position and visible' using errcode = '22023';
    end if;
    update public.sell_grid_tabs
    set position = v_row.position, visible = v_row.visible, updated_at = clock_timestamp()
    where id = v_row.id;
    if not found then
      raise exception 'sell grid tab % does not exist', v_row.id using errcode = 'P0002';
    end if;
  end loop;

  -- Tiles.
  if (select count(*) <> count(distinct (e ->> 'tab_id') || '/' || (e ->> 'product_id'))
      from jsonb_array_elements(p_tiles) e) then
    raise exception 'a tile appears twice' using errcode = '22023';
  end if;
  for v_row in
    select (e ->> 'tab_id')::uuid as tab_id,
           (e ->> 'product_id')::uuid as product_id,
           (e ->> 'position')::integer as position,
           (e ->> 'hidden')::boolean as hidden
    from jsonb_array_elements(p_tiles) e
  loop
    if v_row.tab_id is null or v_row.product_id is null
       or v_row.position is null or v_row.hidden is null then
      raise exception 'a tile needs tab_id, product_id, position and hidden' using errcode = '22023';
    end if;
    select * into v_tab from public.sell_grid_tabs where id = v_row.tab_id;
    if not found then
      raise exception 'sell grid tab % does not exist', v_row.tab_id using errcode = 'P0002';
    end if;
    -- Favoris takes any product; a category tab takes the category's products
    -- and its sub-categories' (migration 036), as resolveGrid does.
    if v_tab.kind = 'category' and not exists (
      select 1
      from public.products p
      left join public.categories c on c.id = p.category_id
      where p.id = v_row.product_id
        and (p.category_id = v_tab.category_id or c.parent_id = v_tab.category_id)
    ) then
      raise exception 'product % does not belong on tab %', v_row.product_id, v_row.tab_id
        using errcode = '23514';
    end if;
    if v_tab.kind = 'favorites' and not exists (
      select 1 from public.products p where p.id = v_row.product_id
    ) then
      raise exception 'product % does not exist', v_row.product_id using errcode = '23514';
    end if;

    insert into public.sell_grid_tiles (tab_id, product_id, position, hidden)
    values (v_row.tab_id, v_row.product_id, v_row.position, v_row.hidden)
    on conflict (tab_id, product_id)
    do update set position = excluded.position, hidden = excluded.hidden;
    -- Other devices notice a changed tab through its updated_at.
    update public.sell_grid_tabs set updated_at = clock_timestamp() where id = v_row.tab_id;
  end loop;

  if not exists (select 1 from public.sell_grid_tabs where visible) then
    raise exception 'at least one tab must stay visible' using errcode = '23514';
  end if;
end;
$$;

revoke execute on function public.save_sell_grid_arrangement(jsonb, jsonb) from public, anon;
grant execute on function public.save_sell_grid_arrangement(jsonb, jsonb) to authenticated;
