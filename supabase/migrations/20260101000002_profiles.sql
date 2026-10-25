-- Profiles: one row per auth user, carries the owner/cashier role
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role user_role not null default 'cashier',
  created_at timestamptz not null default now()
);

-- Auto-create a profile when a new auth user signs up.
-- New users default to 'cashier'; promote to 'owner' manually in the DB.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email), 'cashier');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper used throughout RLS policies: is the current user an owner?
create function public.is_owner()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  );
$$;
