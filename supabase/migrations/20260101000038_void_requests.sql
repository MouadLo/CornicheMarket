-- Void requests (C12): a cashier cannot void a sale (ring up, pocket the cash,
-- void is the classic theft). Instead they ASK; the owner approves or refuses.
-- Until approved the sale counts normally, so the cash stays expected in the
-- drawer.
--
-- Security model:
--   * the table is readable by the owner (all rows) and by a cashier (own rows);
--   * nobody writes it directly: insert/update/delete are revoked and the only
--     writers are the two security-definer functions below;
--   * approval goes through public.void_sale, so the owner-only check, the stock
--     restore and the closed-day lock (migration 037) all still apply. If
--     void_sale raises, the whole decision rolls back and the request stays
--     pending.

create table public.void_requests (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id),
  requested_by uuid not null default auth.uid() references public.profiles (id),
  reason_code text not null
    check (reason_code in ('wrong_item', 'wrong_quantity', 'customer_changed_mind', 'other')),
  note text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'refused')),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  refusal_note text
);

-- At most one open request per sale.
create unique index uq_void_requests_pending
  on public.void_requests (sale_id) where status = 'pending';
create index idx_void_requests_requester on public.void_requests (requested_by, requested_at desc);

alter table public.void_requests enable row level security;

create policy void_requests_owner_read on public.void_requests
  for select using (public.is_owner());
create policy void_requests_own_read on public.void_requests
  for select using (requested_by = auth.uid());

revoke all on public.void_requests from public, anon, authenticated;
grant select on public.void_requests to authenticated;

-------------------------------------------------------------------------------
-- Ask the owner to void one of MY sales. Returns the new request id.
-- A second request while one is pending raises 23505 ("already pending"); the
-- app shows the existing status instead of offering the button again.
-------------------------------------------------------------------------------
create function public.request_void(
  p_sale_id uuid,
  p_reason_code text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_sale public.sales%rowtype;
  v_note text := nullif(btrim(p_note), '');
  v_id uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles where id = v_actor and role in ('owner', 'cashier')
  ) then
    raise exception 'Authenticated staff required' using errcode = '42501';
  end if;
  if p_reason_code is null
     or p_reason_code not in ('wrong_item', 'wrong_quantity', 'customer_changed_mind', 'other') then
    raise exception 'Unknown reason' using errcode = '22023';
  end if;
  if p_reason_code = 'other' and v_note is null then
    raise exception 'A note is required for this reason' using errcode = '22023';
  end if;

  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    raise exception 'Sale not found' using errcode = 'P0002';
  end if;
  -- Only the person who rang the sale up may ask about it.
  if v_sale.cashier_id is distinct from v_actor then
    raise exception 'You can only ask about your own sales' using errcode = '42501';
  end if;
  if v_sale.voided_at is not null then
    raise exception 'This sale is already voided' using errcode = '22023';
  end if;
  if exists (select 1 from public.day_closes where day = public.store_day(v_sale.occurred_at)) then
    raise exception 'The day is closed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.void_requests where sale_id = p_sale_id and status = 'pending') then
    raise exception 'A void request is already pending for this sale' using errcode = '23505';
  end if;

  insert into public.void_requests (sale_id, requested_by, reason_code, note)
  values (p_sale_id, v_actor, p_reason_code, v_note)
  returning id into v_id;
  return v_id;
end;
$$;

-------------------------------------------------------------------------------
-- Owner decision. Approve = void the sale (through void_sale) then mark it.
-------------------------------------------------------------------------------
create function public.decide_void_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_req public.void_requests%rowtype;
  v_name text;
  v_reason text;
begin
  if not public.is_owner() then
    raise exception 'Only an owner can decide a void request' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'A decision is required' using errcode = '22023';
  end if;

  -- Lock the row so two owner sessions cannot decide it twice.
  select * into v_req from public.void_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been decided' using errcode = '22023';
  end if;

  if p_approve then
    select coalesce(full_name, '') into v_name from public.profiles where id = v_req.requested_by;
    v_reason := v_req.reason_code
      || coalesce(' - ' || v_req.note, '')
      || ' (requested by ' || coalesce(nullif(v_name, ''), v_req.requested_by::text) || ')';
    -- Raises if the day is closed; then nothing below runs and it stays pending.
    perform public.void_sale(v_req.sale_id, v_reason);
    update public.void_requests
    set status = 'approved', decided_by = v_actor, decided_at = now()
    where id = p_request_id;
  else
    update public.void_requests
    set status = 'refused', decided_by = v_actor, decided_at = now(),
        refusal_note = nullif(btrim(p_note), '')
    where id = p_request_id;
  end if;
end;
$$;

revoke execute on function public.request_void(uuid, text, text) from public, anon;
revoke execute on function public.decide_void_request(uuid, boolean, text) from public, anon;
grant execute on function public.request_void(uuid, text, text) to authenticated;
grant execute on function public.decide_void_request(uuid, boolean, text) to authenticated;
