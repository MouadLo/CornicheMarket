-- Fix for 054: the trigger that bumps the feed version ran
-- `update webstore_state set version = version + 1` with no WHERE. Supabase's
-- API layer (pg_safeupdate) refuses an UPDATE without a WHERE, so every write to
-- a web table through the API failed with "UPDATE requires a WHERE clause".
-- (Direct SQL as postgres, which CI and the import use, does not enforce it.)
create or replace function public.webstore_bump_version()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.webstore_state set version = version + 1 where id;
  return null;
end;
$$;
