-- Shared shop printer (migration 047). Runs in CI after `supabase db reset`, as
-- postgres. Every write is rolled back. The seed has an owner 'aa' and a
-- cashier 'bb'.
begin;

delete from public.print_jobs;
delete from public.print_station_heartbeat;

-- A second cashier.
insert into auth.users (id, email, instance_id, aud, role)
values ('00000000-0000-0000-0000-0000000000cc', 'cashier2-print@example.test',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
on conflict (id) do nothing;
insert into public.profiles (id, full_name, role)
values ('00000000-0000-0000-0000-0000000000cc', 'Second cashier', 'cashier')
on conflict (id) do nothing;

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.status_of(p_id uuid) returns text language sql as $$
  select status from public.print_jobs where id = p_id;
$$;

do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000aa';
  bb uuid := '00000000-0000-0000-0000-0000000000bb';
  cc uuid := '00000000-0000-0000-0000-0000000000cc';
  j1 uuid := '47000000-0000-0000-0000-000000000001';
  j2 uuid := '47000000-0000-0000-0000-000000000002';
  j3 uuid := '47000000-0000-0000-0000-000000000003';
  stale uuid := '47000000-0000-0000-0000-000000000009';
  v_job public.print_jobs;
  v_count integer;
  v_rows integer;
begin
  ---------------------------------------------------------------- anon: nothing
  execute 'set local role anon';
  begin
    insert into public.print_jobs (id, cashier_label, receipt, language)
    values ('47000000-0000-0000-0000-0000000000f1', 'x', '{}', 'fr');
    raise exception 'anon inserted a print job';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.print_jobs;
    raise exception 'anon read print jobs';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_next_print_job();
    raise exception 'anon claimed a print job';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  ---------------------------------------------------------------- station offline at first
  perform pg_temp.as_user(bb);
  execute 'set local role authenticated';
  if public.print_station_online() then
    raise exception 'The station must be offline before any claim';
  end if;

  ---------------------------------------------------------------- cashier queues jobs
  insert into public.print_jobs (id, cashier_label, receipt, language, time_zone)
  values (j1, 'Sara', '{"receiptNumber":"A"}', 'fr', 'Africa/Casablanca');
  select * into v_job from public.print_jobs where id = j1;
  if v_job.status <> 'pending' or v_job.created_by <> bb or v_job.attempts <> 0 then
    raise exception 'A queued job must be pending, owned by its creator';
  end if;

  -- another user's id is refused by RLS
  begin
    insert into public.print_jobs (id, created_by, cashier_label, receipt, language)
    values ('47000000-0000-0000-0000-0000000000f2', cc, 'Fake', '{}', 'fr');
    raise exception 'A job was queued in somebody else''s name';
  exception when insufficient_privilege then null;
  end;
  -- cannot choose the status
  begin
    insert into public.print_jobs (id, cashier_label, receipt, language, status)
    values ('47000000-0000-0000-0000-0000000000f3', 'Sara', '{}', 'fr', 'printed');
    raise exception 'A job was queued with a chosen status';
  exception when insufficient_privilege then null;
  end;
  -- bad data
  begin
    insert into public.print_jobs (id, cashier_label, receipt, language)
    values ('47000000-0000-0000-0000-0000000000f4', 'Sara', '[]', 'fr');
    raise exception 'A non-object receipt was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.print_jobs (id, cashier_label, receipt, language)
    values ('47000000-0000-0000-0000-0000000000f5', 'Sara', '{}', 'es');
    raise exception 'An unknown language was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.print_jobs (id, cashier_label, receipt, language)
    values ('47000000-0000-0000-0000-0000000000f6', '', '{}', 'fr');
    raise exception 'An empty cashier label was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.print_jobs (id, cashier_label, receipt, language)
    values ('47000000-0000-0000-0000-0000000000f7', 'Sara',
            jsonb_build_object('big', repeat('x', 40000)), 'fr');
    raise exception 'An oversized receipt was accepted';
  exception when check_violation then null;
  end;

  -- the second cashier queues the next one (a moment later)
  perform pg_temp.as_user(cc);
  insert into public.print_jobs (id, cashier_label, receipt, language)
  values (j2, 'Second', '{"receiptNumber":"B"}', 'ar');
  execute 'reset role';
  update public.print_jobs set created_at = now() + interval '1 second' where id = j2;

  -- an old pending job, inserted as postgres
  insert into public.print_jobs (id, created_by, cashier_label, receipt, language, created_at)
  values (stale, bb, 'Sara', '{}', 'fr', now() - interval '5 minutes');

  ---------------------------------------------------------------- no direct update / delete
  perform pg_temp.as_user(bb);
  execute 'set local role authenticated';
  begin
    update public.print_jobs set status = 'printed' where id = j1;
    raise exception 'A client updated a job directly';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.print_jobs where id = j1;
    raise exception 'A client deleted a job directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.print_station_heartbeat;
    raise exception 'A client read the heartbeat table';
  exception when insufficient_privilege then null;
  end;

  -- anyone signed in reads the queue
  select count(*) into v_count from public.print_jobs;
  if v_count <> 3 then
    raise exception 'Signed-in staff must read all jobs, saw %', v_count;
  end if;

  ---------------------------------------------------------------- station claims in order
  perform pg_temp.as_user(owner_id);
  select * into v_job from public.claim_next_print_job();
  if v_job.id is distinct from j1 or v_job.status <> 'printing' or v_job.attempts <> 1
     or v_job.claimed_at is null then
    raise exception 'The first claim must return the oldest fresh pending job, got %', v_job.id;
  end if;
  if not public.print_station_online() then
    raise exception 'The station must be online right after a claim';
  end if;

  select * into v_job from public.claim_next_print_job();
  if v_job.id is distinct from j2 then
    raise exception 'The second claim must return the next job, got %', v_job.id;
  end if;

  -- the stale one is not auto-claimed
  select count(*) into v_count from public.claim_next_print_job();
  if v_count <> 0 then
    raise exception 'A pending job older than 2 minutes must not be auto-claimed';
  end if;
  if pg_temp.status_of(stale) <> 'pending' then
    raise exception 'The stale job must stay pending';
  end if;

  ---------------------------------------------------------------- manual claim of the stale job
  select * into v_job from public.claim_print_job(stale);
  if v_job.status <> 'printing' then
    raise exception 'claim_print_job must claim a stale pending job';
  end if;
  -- being printed (fresh claim): refused
  begin
    perform public.claim_print_job(stale);
    raise exception 'A job being printed was claimed again';
  exception when others then
    if sqlstate <> 'CM409' then raise; end if;
  end;
  begin
    perform public.claim_print_job('47000000-0000-0000-0000-0000000000ee');
    raise exception 'A missing job was claimed';
  exception when others then
    if sqlstate <> 'CM404' then raise; end if;
  end;

  ---------------------------------------------------------------- finish
  select * into v_job from public.finish_print_job(j1, true);
  if v_job.status <> 'printed' or v_job.printed_at is null then
    raise exception 'finish ok must mark the job printed';
  end if;
  select * into v_job from public.finish_print_job(j2, false, repeat('e', 500));
  if v_job.status <> 'failed' or char_length(v_job.error) <> 200 then
    raise exception 'finish failed must store a truncated error';
  end if;
  begin
    perform public.finish_print_job(j1, true);
    raise exception 'A printed job was finished twice';
  exception when others then
    if sqlstate <> 'CM409' then raise; end if;
  end;

  -- a failed job can be claimed by hand, and ignored
  select * into v_job from public.claim_print_job(j2);
  if v_job.status <> 'printing' or v_job.attempts <> 2 then
    raise exception 'A failed job must be claimable by hand';
  end if;
  perform public.finish_print_job(j2, false, 'again');
  select * into v_job from public.cancel_print_job(j2);
  if v_job.status <> 'cancelled' then
    raise exception 'A failed job must be cancellable';
  end if;
  begin
    perform public.cancel_print_job(j1);
    raise exception 'A printed job was cancelled';
  exception when others then
    if sqlstate <> 'CM409' then raise; end if;
  end;

  ---------------------------------------------------------------- requeue (phone retry)
  perform pg_temp.as_user(bb);
  insert into public.print_jobs (id, cashier_label, receipt, language)
  values (j3, 'Sara', '{}', 'fr');
  execute 'reset role';
  update public.print_jobs set status = 'failed', error = 'paper out',
    created_at = now() - interval '10 minutes' where id = j3;

  perform pg_temp.as_user(cc);
  execute 'set local role authenticated';
  begin
    perform public.requeue_print_job(j3);
    raise exception 'Another cashier requeued a job that is not theirs';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.as_user(bb);
  select * into v_job from public.requeue_print_job(j3);
  if v_job.status <> 'pending' or v_job.created_at < now() - interval '1 minute' or v_job.error is not null then
    raise exception 'The creator must be able to requeue a failed job';
  end if;
  -- the station now picks it up as a fresh job
  perform pg_temp.as_user(owner_id);
  select * into v_job from public.claim_next_print_job();
  if v_job.id is distinct from j3 then
    raise exception 'A requeued job must be claimed as fresh';
  end if;
  perform public.finish_print_job(j3, true);
  -- a printed job is left alone
  perform pg_temp.as_user(bb);
  select * into v_job from public.requeue_print_job(j3);
  if v_job.status <> 'printed' then
    raise exception 'Requeue must not reprint a printed job';
  end if;
  -- the owner may requeue someone else's failed job
  perform pg_temp.as_user(owner_id);
  execute 'reset role';
  update public.print_jobs set status = 'failed' where id = j3;
  execute 'set local role authenticated';
  select * into v_job from public.requeue_print_job(j3);
  if v_job.status <> 'pending' then
    raise exception 'The owner must be able to requeue any job';
  end if;
  execute 'reset role';
end $$;

rollback;
