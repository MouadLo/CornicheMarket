-- Shared shop printer ("Poste d'impression").
--
-- The shop has one thermal printer on a PC. A cashier's phone queues a print
-- job here; the PC (signed in, window open) claims jobs one at a time and
-- prints them. The job carries the receipt as DATA (a ReceiptModel JSON), never
-- HTML: the station renders it with its own code, so a phone cannot make the
-- station's browser run anything.
--
-- Clients may insert their own pending job and read jobs. Every status change
-- goes through the functions below (no direct UPDATE / DELETE).
--
-- Errors (SQLSTATE): 28000 not signed in, 42501 not allowed,
--   CM404 no such job, CM409 job in a state that does not allow the action.

create table public.print_jobs (
  id uuid primary key,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  cashier_label text not null check (char_length(cashier_label) between 1 and 60),
  receipt jsonb not null check (
    jsonb_typeof(receipt) = 'object' and octet_length(receipt::text) <= 32768
  ),
  language text not null check (language in ('fr', 'en', 'ar')),
  time_zone text check (char_length(time_zone) <= 64),
  status text not null default 'pending'
    check (status in ('pending', 'printing', 'printed', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  printed_at timestamptz,
  error text check (char_length(error) <= 200),
  attempts integer not null default 0
);
create index idx_print_jobs_status_created on public.print_jobs (status, created_at);

alter table public.print_jobs enable row level security;

create policy "staff read print jobs" on public.print_jobs
  for select using (auth.uid() is not null);
create policy "staff queue their own print job" on public.print_jobs
  for insert with check (
    auth.uid() is not null and created_by = auth.uid() and status = 'pending'
  );

revoke all on public.print_jobs from public, anon, authenticated;
grant select on public.print_jobs to authenticated;
grant insert (id, created_by, cashier_label, receipt, language, time_zone)
  on public.print_jobs to authenticated;

create table public.print_station_heartbeat (
  id integer primary key default 1 check (id = 1),
  last_seen_at timestamptz not null default now(),
  station_user uuid
);
alter table public.print_station_heartbeat enable row level security;
revoke all on public.print_station_heartbeat from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Station: claim the next fresh pending job (also the heartbeat).
-------------------------------------------------------------------------------
create function public.claim_next_print_job()
returns setof public.print_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  insert into public.print_station_heartbeat (id, last_seen_at, station_user)
  values (1, now(), auth.uid())
  on conflict (id) do update set last_seen_at = now(), station_user = auth.uid();

  delete from public.print_jobs where created_at < now() - interval '3 days';

  select id into v_id
  from public.print_jobs
  where status = 'pending' and created_at > now() - interval '2 minutes'
  order by created_at, id
  limit 1
  for update skip locked;

  if v_id is null then
    return;
  end if;

  return query
    update public.print_jobs
    set status = 'printing', claimed_at = now(), attempts = attempts + 1
    where id = v_id
    returning *;
end;
$$;

-- Manual print of an old or failed job from the station.
create function public.claim_print_job(p_id uuid)
returns public.print_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.print_jobs;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_job from public.print_jobs where id = p_id for update;
  if not found then
    raise exception 'Print job not found' using errcode = 'CM404';
  end if;

  if v_job.status in ('pending', 'failed')
     or (v_job.status = 'printing' and v_job.claimed_at < now() - interval '1 minute') then
    update public.print_jobs
    set status = 'printing', claimed_at = now(), attempts = attempts + 1, error = null
    where id = p_id
    returning * into v_job;
    return v_job;
  end if;

  raise exception 'Already printed or being printed' using errcode = 'CM409';
end;
$$;

create function public.finish_print_job(p_id uuid, p_ok boolean, p_error text default null)
returns public.print_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.print_jobs;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_job from public.print_jobs where id = p_id for update;
  if not found then
    raise exception 'Print job not found' using errcode = 'CM404';
  end if;
  if v_job.status <> 'printing' then
    raise exception 'Job is not being printed' using errcode = 'CM409';
  end if;

  if p_ok then
    update public.print_jobs
    set status = 'printed', printed_at = now(), error = null
    where id = p_id returning * into v_job;
  else
    update public.print_jobs
    set status = 'failed', error = left(coalesce(nullif(p_error, ''), 'print failed'), 200)
    where id = p_id returning * into v_job;
  end if;
  return v_job;
end;
$$;

create function public.cancel_print_job(p_id uuid)
returns public.print_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.print_jobs;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_job from public.print_jobs where id = p_id for update;
  if not found then
    raise exception 'Print job not found' using errcode = 'CM404';
  end if;
  if v_job.status not in ('pending', 'failed') then
    raise exception 'Only a waiting or failed job can be ignored' using errcode = 'CM409';
  end if;

  update public.print_jobs set status = 'cancelled' where id = p_id returning * into v_job;
  return v_job;
end;
$$;

-- Phone retry: only the person who queued the job (or the owner).
create function public.requeue_print_job(p_id uuid)
returns public.print_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.print_jobs;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_job from public.print_jobs where id = p_id for update;
  if not found then
    raise exception 'Print job not found' using errcode = 'CM404';
  end if;
  if v_job.created_by <> auth.uid() and not public.is_owner() then
    raise exception 'Not your print job' using errcode = '42501';
  end if;

  if v_job.status in ('failed', 'pending') then
    update public.print_jobs
    set status = 'pending', created_at = now(), error = null
    where id = p_id returning * into v_job;
  end if;
  return v_job;
end;
$$;

create function public.print_station_online()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and coalesce(
    (select last_seen_at > now() - interval '15 seconds'
     from public.print_station_heartbeat where id = 1),
    false
  );
$$;

revoke execute on function
  public.claim_next_print_job(), public.claim_print_job(uuid),
  public.finish_print_job(uuid, boolean, text), public.cancel_print_job(uuid),
  public.requeue_print_job(uuid), public.print_station_online()
from public, anon;
grant execute on function
  public.claim_next_print_job(), public.claim_print_job(uuid),
  public.finish_print_job(uuid, boolean, text), public.cancel_print_job(uuid),
  public.requeue_print_job(uuid), public.print_station_online()
to authenticated;
