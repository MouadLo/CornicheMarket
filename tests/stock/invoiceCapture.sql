begin;

select set_config('request.jwt.claim.role', 'authenticated', true);
-- The JWT uid is set as postgres so the fixture lookup itself bypasses RLS.
select set_config('request.jwt.claim.sub', id::text, true) from public.profiles where role = 'cashier' limit 1;
set local role authenticated;
do $$
begin
  if auth.uid() is null or public.is_owner() then raise exception 'Missing cashier fixture'; end if;
  if exists (select from public.invoice_drafts) then raise exception 'Cashier saw an invoice'; end if;
  begin
    perform public.create_invoice_draft();
    raise exception 'Cashier created a draft';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', id::text, true) from public.profiles where role = 'owner' limit 1;
set local role authenticated;
select set_config('invoice_test.draft_id', public.create_invoice_draft()::text, true);

insert into storage.objects (bucket_id, name)
values ('invoices', current_setting('invoice_test.draft_id') || '/1.jpg');

do $$
declare n integer;
begin
  if not exists (select from storage.objects where bucket_id = 'invoices') then
    raise exception 'Owner cannot read invoice photos';
  end if;
  update storage.objects set name = 'changed' where bucket_id = 'invoices';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Owner changed an invoice photo'; end if;
  -- Storage API enables this session setting before issuing a delete.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'invoices';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Owner deleted an invoice photo'; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', id::text, true) from public.profiles where role = 'cashier' limit 1;
set local role authenticated;
do $$
begin
  if exists (select from storage.objects where bucket_id = 'invoices') then
    raise exception 'Cashier saw invoice photos';
  end if;
  begin
    insert into storage.objects (bucket_id, name)
      values ('invoices', current_setting('invoice_test.draft_id') || '/2.jpg');
    raise exception 'Cashier uploaded a photo';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role anon;
do $$
begin
  if exists (select from storage.objects where bucket_id = 'invoices') then
    raise exception 'Anonymous user saw invoice photos';
  end if;
end $$;
reset role;

do $$
declare
  v_draft uuid := current_setting('invoice_test.draft_id')::uuid;
  v_result record;
  v_day date := (now() at time zone public.store_timezone())::date;
begin
  insert into public.invoice_extraction_quota (store_day, attempts) values (v_day, 59)
    on conflict (store_day) do update set attempts = 59;
  select * into v_result from public.claim_invoice_extraction(v_draft);
  if v_result.result <> 'claimed' or cardinality(v_result.paths) <> 1 then raise exception 'No valid extraction claim'; end if;
  if (select result from public.claim_invoice_extraction(v_draft)) <> 'busy' then raise exception 'Second claim not blocked'; end if;
  update public.invoice_drafts set status = 'failed' where id = v_draft;
  if (select result from public.claim_invoice_extraction(v_draft)) <> 'daily_limit' then raise exception 'Daily limit failed'; end if;
end $$;

update public.invoice_drafts set status = 'ready', source_lines = '[{}]'
where id = current_setting('invoice_test.draft_id')::uuid;

select set_config('request.jwt.claim.sub', id::text, true) from public.profiles where role = 'owner' limit 1;
set local role authenticated;
do $$
declare
  v_draft uuid := current_setting('invoice_test.draft_id')::uuid;
  v_supplier uuid := (select id from public.suppliers limit 1);
  v_line jsonb := '[{"new_product":{"name":"Invoice fixture","selling_price_cents":200},"unit":"piece","quantity":1,"unit_cost_cents":100}]';
begin
  begin
    perform public.approve_invoice_draft(v_draft, 1, v_line);
    raise exception 'Approved without supplier';
  exception when invalid_parameter_value then null;
  end;
  if public.update_invoice_draft_header(v_draft, 1, v_supplier, null, null) <> 2 then
    raise exception 'Header did not bump revision';
  end if;
  begin
    perform public.approve_invoice_draft(v_draft, 2, v_line);
    raise exception 'Approved without invoice number';
  exception when invalid_parameter_value then null;
  end;
  perform public.update_invoice_draft_header(v_draft, 2, v_supplier, 'CAPTURE-TEST', '2026-01-20');
  perform public.approve_invoice_draft(v_draft, 3, v_line);
  begin
    perform public.update_invoice_draft_header(v_draft, 3, v_supplier, 'CHANGED', null);
    raise exception 'Approved invoice header changed';
  exception when sqlstate 'CM413' then null;
  end;
end $$;

rollback;
