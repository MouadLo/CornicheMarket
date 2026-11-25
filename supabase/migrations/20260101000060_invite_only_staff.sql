-- Signed in is not the same as staff.
--
-- Found in the 2026-11-25 review, on staging, where "Allow new users to sign up"
-- was on: anyone could register with the public key, confirm their email and
-- become a cashier, because every new Auth user got a 'cashier' profile. And an
-- account with NO profile was not stopped either: eight policies only asked for
-- "authenticated", print jobs only for "signed in", four views run as their owner
-- with no staff check, and the pre-request check let a missing profile through.
-- Production had sign-up off, so only invited accounts could exist there.
--
-- Fixed four ways:
--   1. Only an invited account gets a profile. Invites (invite-cashier,
--      manage-staff) use inviteUserByEmail, which sets auth.users.invited_at on
--      the row it inserts. Existing profiles are untouched.
--   2. PostgREST's pre-request check refuses EVERY request of a signed-in
--      account that is not active staff (no profile, or deactivated), with the
--      same PT403 the app already handles. This covers tables, views and RPCs;
--      it is what guards the four owner-run views with no staff filter
--      (products_cashier_view, customer_balances, product_sales_30d,
--      expiring_batches), which a plain SQL session would still read.
--   3. The policies that said "authenticated" or "signed in" now say active staff.
--   4. Anonymous visitors can no longer call the day functions.

-- 1 --------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.invited_at is null then
    return new;
  end if;
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email), 'cashier');
  return new;
end;
$$;

-- 2 --------------------------------------------------------------------------
create or replace function public.check_active_staff()
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
  if not exists (
    select 1 from public.profiles where id = v_uid and deactivated_at is null
  ) then
    raise exception 'Account deactivated' using errcode = 'PT403';
  end if;
end;
$$;

-- 3 --------------------------------------------------------------------------
alter policy "anyone authenticated can read categories" on public.categories using (public.is_active_staff());
alter policy "staff read payments" on public.customer_payments using (public.is_active_staff());
alter policy "staff read customers" on public.customers using (public.is_active_staff());
alter policy "staff add customers" on public.customers with check (public.is_active_staff());
alter policy "authenticated reads grid tabs" on public.sell_grid_tabs using (public.is_active_staff());
alter policy "authenticated reads grid tiles" on public.sell_grid_tiles using (public.is_active_staff());
alter policy "anyone authenticated reads store settings" on public.store_settings using (public.is_active_staff());
alter policy "anyone authenticated can read suppliers" on public.suppliers using (public.is_active_staff());
alter policy "staff read print jobs" on public.print_jobs using (public.is_active_staff());
alter policy "staff queue their own print job" on public.print_jobs
  with check (public.is_active_staff() and created_by = auth.uid() and status = 'pending');

-- 4 --------------------------------------------------------------------------
revoke execute on function public.day_summary(date) from public, anon;
revoke execute on function public.day_is_closed(date) from public, anon;
revoke execute on function public.close_day(date, bigint, bigint, bigint, text) from public, anon;
revoke execute on function public.reopen_day(date) from public, anon;
grant execute on function public.day_summary(date) to authenticated;
grant execute on function public.day_is_closed(date) to authenticated;
grant execute on function public.close_day(date, bigint, bigint, bigint, text) to authenticated;
grant execute on function public.reopen_day(date) to authenticated;
