-- Sub-categories (migration 036). Runs in CI after `supabase db reset`, as
-- postgres. Every write is rolled back.
begin;

insert into public.categories (name) values ('Main A'), ('Main B'), ('Loose C');
insert into public.categories (name, parent_id)
  select 'Sub A1', id from public.categories where name = 'Main A';

do $$
declare
  main_a uuid := (select id from public.categories where name = 'Main A');
  sub_a1 uuid := (select id from public.categories where name = 'Sub A1');
  loose_c uuid := (select id from public.categories where name = 'Loose C');
begin
  -- A sub-category gets no Sell tab; its parent keeps one.
  if exists (select 1 from public.sell_grid_tabs where category_id = sub_a1) then
    raise exception 'A sub-category got a Sell tab';
  end if;
  if not exists (select 1 from public.sell_grid_tabs where category_id = main_a) then
    raise exception 'A main category lost its Sell tab';
  end if;

  -- No second level.
  begin
    insert into public.categories (name, parent_id) values ('Sub-sub', sub_a1);
    raise exception 'A sub-category accepted a child';
  exception when check_violation then null;
  end;

  -- A parent cannot become a sub-category.
  begin
    update public.categories set parent_id = loose_c where id = main_a;
    raise exception 'A category with children became a sub-category';
  exception when check_violation then null;
  end;

  -- A parent with children cannot be deleted.
  begin
    delete from public.categories where id = main_a;
    raise exception 'A parent with sub-categories was deleted';
  exception when foreign_key_violation then null;
  end;

  -- Moving a main category under another drops its tab; moving it back restores one.
  update public.categories set parent_id = main_a where id = loose_c;
  if exists (select 1 from public.sell_grid_tabs where category_id = loose_c) then
    raise exception 'A category moved under a parent kept its Sell tab';
  end if;
  update public.categories set parent_id = null where id = loose_c;
  if not exists (select 1 from public.sell_grid_tabs where category_id = loose_c) then
    raise exception 'A category made main again got no Sell tab';
  end if;
end;
$$;

-- Bulk price on a main category includes its sub-categories.
insert into public.products (name, selling_price_cents, category_id)
  select 'Sub product', 1000, id from public.categories where name = 'Sub A1';

do $$
begin
  perform public.bulk_adjust_selling_price((select id from public.categories where name = 'Main A'), 10);
  if (select selling_price_cents from public.products where name = 'Sub product') <> 1100 then
    raise exception 'Bulk price on a main category skipped its sub-category';
  end if;
end;
$$;

rollback;
