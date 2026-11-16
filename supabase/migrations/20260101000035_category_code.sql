-- Category codes: the stable identity of a category chosen from the app's
-- starter catalogue (src/lib/products/categoryCatalog.ts), so the same category
-- means the same thing for every owner and in every language. The name column
-- stays what is shown and searched; a category the owner typed himself has no
-- code. Additive: existing rows keep working untouched.
alter table public.categories add column code text;

alter table public.categories
  add constraint categories_code_format check (code is null or code ~ '^[a-z][a-z0-9_.]{0,59}$');

-- At most one category per code. Rows without a code are unconstrained here
-- (their names are already unique).
create unique index categories_code_unique on public.categories (code) where code is not null;
