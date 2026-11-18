-- Staff deactivation (UX review O4): the owner can deactivate a cashier who
-- leaves. They can no longer sign in or use the app; every sale, void,
-- adjustment and activity-log line they made keeps their name. Nothing is ever
-- deleted.
--
-- Banning the user in Supabase Auth is not enough on its own: a banned user's
-- access token stays valid for up to an hour, and the security definer
-- functions (record_sale, record_customer_payment, request_void, ...) bypass
-- RLS. So the block lives in the database and is checked on EVERY API request:
-- public.check_active_staff() is PostgREST's pre-request function. The Auth ban
-- (applied by the manage-staff Edge Function) stops new sign-ins and token
-- refreshes on top of that.

alter table public.profiles
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references public.profiles (id) on delete set null;

-- ============================================================
-- The two columns change ONLY through set_staff_active (below).
--
-- Every path that could clear them from the API:
--   1. policy "self can update own name": a cashier updating their own row
--   2. policy "owner manages profiles" (for all): an owner updating, inserting
--      or deleting any row directly
--   3. deleting the profile row (a missing profile passes the pre-request check)
-- Closed twice: by privilege (column-level grants, so the statement is refused
-- before any row is touched) and by a trigger that does not depend on grants.
-- ============================================================
revoke insert, update, delete on public.profiles from authenticated, anon;
grant update (full_name, role) on public.profiles to authenticated;

create function public.guard_staff_deactivation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- current_user is the API role for a direct request (authenticated, anon) and
  -- the function owner inside a security definer function, migrations, or the
  -- service role: only the direct API paths are blocked here.
  if current_user not in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A staff profile cannot be deleted' using errcode = '42501';
  elsif tg_op = 'INSERT' then
    if new.deactivated_at is not null or new.deactivated_by is not null then
      raise exception 'Only set_staff_active can deactivate an account' using errcode = '42501';
    end if;
  elsif new.deactivated_at is distinct from old.deactivated_at
     or new.deactivated_by is distinct from old.deactivated_by then
    raise exception 'Only set_staff_active can change whether an account is active'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_profiles_guard_deactivation
  before insert or update or delete on public.profiles
  for each row execute function public.guard_staff_deactivation();

-- ============================================================
-- Pre-request check: refuse every API request of a deactivated user.
-- Anonymous requests (no sub) and users without a profile row pass unchanged, so
-- sign-in and the invite flow keep working. One primary-key lookup.
-- PT403 makes PostgREST answer HTTP 403 with code "PT403".
-- ============================================================
create function public.check_active_staff()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;
  if exists (
    select 1 from public.profiles where id = v_uid and deactivated_at is not null
  ) then
    raise exception 'Account deactivated' using errcode = 'PT403';
  end if;
end;
$$;

revoke execute on function public.check_active_staff() from public;
grant execute on function public.check_active_staff() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request to 'public.check_active_staff';
notify pgrst, 'reload config';

-- ============================================================
-- set_staff_active: the only way to deactivate or reactivate. Owner only.
-- ============================================================
create function public.set_staff_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception 'Only an owner can manage staff' using errcode = '42501';
  end if;
  if p_user_id is null or p_active is null then
    raise exception 'A staff member and a status are required' using errcode = '22023';
  end if;

  select role into v_role from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'Staff member not found' using errcode = 'P0002';
  end if;

  if p_active then
    update public.profiles
       set deactivated_at = null, deactivated_by = null
     where id = p_user_id and deactivated_at is not null;
    return;
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot deactivate your own account' using errcode = '22023';
  end if;
  if v_role = 'owner' then
    raise exception 'An owner account cannot be deactivated' using errcode = '22023';
  end if;

  -- Idempotent: keeps the first deactivation time and who did it.
  update public.profiles
     set deactivated_at = now(), deactivated_by = auth.uid()
   where id = p_user_id and deactivated_at is null;

  -- Best effort on top of the block above: end their sessions so their refresh
  -- tokens die with them. Never undoes the block if the Auth schema refuses.
  begin
    delete from auth.sessions where user_id = p_user_id;
  exception when others then
    null;
  end;
end;
$$;

revoke execute on function public.set_staff_active(uuid, boolean) from public, anon;
grant execute on function public.set_staff_active(uuid, boolean) to authenticated;

-- ============================================================
-- list_staff: everyone with an account, for the owner's Staff list. Reads
-- auth.users inside the function; nothing of auth.users is otherwise exposed.
-- ============================================================
create function public.list_staff()
returns table (
  id uuid,
  full_name text,
  role public.user_role,
  email text,
  invite_accepted boolean,
  last_sign_in_at timestamptz,
  deactivated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception 'Only an owner can list staff' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.role, u.email::text,
           (u.email_confirmed_at is not null or u.last_sign_in_at is not null),
           u.last_sign_in_at, p.deactivated_at
      from public.profiles p
      join auth.users u on u.id = p.id
     order by (p.role = 'owner') desc, (p.deactivated_at is not null), p.full_name;
end;
$$;

revoke execute on function public.list_staff() from public, anon;
grant execute on function public.list_staff() to authenticated;
