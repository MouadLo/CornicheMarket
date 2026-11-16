-- Category codes (migration 035). Runs in CI after `supabase db reset`, as
-- postgres. Every write is rolled back.
begin;

insert into public.categories (name, code) values ('Cat A', 'beverages_test');

do $$
begin
  begin
    insert into public.categories (name, code) values ('Cat B', 'beverages_test');
    raise exception 'Two categories shared a code';
  exception when unique_violation then null;
  end;

  begin
    insert into public.categories (name, code) values ('Cat C', 'Bad Code!');
    raise exception 'A malformed code was accepted';
  exception when check_violation then null;
  end;

  -- Rows with no code never collide on it.
  insert into public.categories (name) values ('Cat D'), ('Cat E');
  if (select count(*) from public.categories where code is null and name in ('Cat D', 'Cat E')) <> 2 then
    raise exception 'Categories without a code were refused';
  end if;

  -- The Sell tab trigger still runs for a coded category.
  if not exists (select 1 from public.sell_grid_tabs t join public.categories c on c.id = t.category_id
                 where c.code = 'beverages_test') then
    raise exception 'A coded category got no Sell tab';
  end if;
end;
$$;

rollback;
