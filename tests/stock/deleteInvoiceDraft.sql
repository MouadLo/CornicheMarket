-- Rules for deleting an invoice draft (migration 042). Runs in CI after
-- `supabase db reset`, as postgres, impersonating the seeded users. Every
-- write is rolled back.
begin;

-- Fixtures, written as postgres.
insert into public.invoice_drafts (id, status, source_lines, photo_paths, invoice_number, extraction_started_at)
values
  ('00000000-0000-0000-0000-00000000d001', 'ready', '[]',
   array['00000000-0000-0000-0000-00000000d001/1.jpg', '00000000-0000-0000-0000-00000000d001/2.jpg'],
   'DEL-READY', null),
  ('00000000-0000-0000-0000-00000000d002', 'extracting', '[]', '{}', null, now() - interval '30 seconds'),
  ('00000000-0000-0000-0000-00000000d003', 'extracting', '[]', '{}', null, now() - interval '5 minutes'),
  ('00000000-0000-0000-0000-00000000d004', 'extracting', '[]', '{}', null, null),
  ('00000000-0000-0000-0000-00000000d005', 'failed', '[]', '{}', null, now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000d006', 'ready', '[{}]',
   array['00000000-0000-0000-0000-00000000d006/1.jpg'], 'DEL-APPROVED', null);

update public.invoice_drafts
set supplier_id = (select id from public.suppliers limit 1)
where id = '00000000-0000-0000-0000-00000000d006';

insert into storage.objects (bucket_id, name) values
  ('invoices', '00000000-0000-0000-0000-00000000d001/1.jpg'),
  ('invoices', '00000000-0000-0000-0000-00000000d001/2.jpg'),
  ('invoices', '00000000-0000-0000-0000-00000000d003/1.jpg'),
  ('invoices', '00000000-0000-0000-0000-00000000d006/1.jpg');

-- A cashier cannot call it.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', id::text, true)
from public.profiles where role = 'cashier' limit 1;
set local role authenticated;
do $$
begin
  if auth.uid() is null or public.is_owner() then raise exception 'Cashier fixture is missing'; end if;
  begin
    perform public.delete_invoice_draft('00000000-0000-0000-0000-00000000d001');
    raise exception 'Cashier deleted a draft';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The owner approves the last draft, so it is an approved one.
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);
set local role authenticated;
do $$
declare
  v_approved uuid := '00000000-0000-0000-0000-00000000d006';
  v_supplier uuid := (select id from public.suppliers limit 1);
begin
  if not public.is_owner() then raise exception 'Owner fixture is missing'; end if;
  perform public.approve_invoice_draft(v_approved, 1,
    '[{"new_product":{"name":"Delete test","selling_price_cents":200},"unit":"piece","quantity":1,"unit_cost_cents":100}]');
  if (select purchase_id from public.invoice_drafts where id = v_approved) is null then
    raise exception 'Fixture was not approved';
  end if;
end $$;

do $$
declare
  v_paths text[];
  n integer;
begin
  -- Not found.
  begin
    perform public.delete_invoice_draft('00000000-0000-0000-0000-00000000dfff');
    raise exception 'A missing draft was accepted';
  exception when sqlstate 'CM404' then null;
  end;

  -- Approved: refused, draft and photo kept.
  begin
    perform public.delete_invoice_draft('00000000-0000-0000-0000-00000000d006');
    raise exception 'An approved draft was deleted';
  exception when sqlstate 'CM413' then null;
  end;
  if not exists (select from public.invoice_drafts where id = '00000000-0000-0000-0000-00000000d006') then
    raise exception 'Approved draft is gone';
  end if;

  -- Extracting for less than 2 minutes: refused.
  begin
    perform public.delete_invoice_draft('00000000-0000-0000-0000-00000000d002');
    raise exception 'A draft being read was deleted';
  exception when sqlstate 'CM415' then null;
  end;
  if not exists (select from public.invoice_drafts where id = '00000000-0000-0000-0000-00000000d002') then
    raise exception 'Draft being read is gone';
  end if;

  -- Storage policy: while the drafts exist, no photo can be deleted.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'invoices';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Owner deleted % photos of existing drafts', n; end if;

  -- Ready draft: deleted, photo paths returned.
  v_paths := public.delete_invoice_draft('00000000-0000-0000-0000-00000000d001');
  if v_paths is distinct from array['00000000-0000-0000-0000-00000000d001/1.jpg', '00000000-0000-0000-0000-00000000d001/2.jpg'] then
    raise exception 'Wrong photo paths returned: %', v_paths;
  end if;
  if exists (select from public.invoice_drafts where id = '00000000-0000-0000-0000-00000000d001') then
    raise exception 'Ready draft was not deleted';
  end if;

  -- Extracting for over 2 minutes, no start time, and failed: allowed.
  if public.delete_invoice_draft('00000000-0000-0000-0000-00000000d003') <> '{}' then raise exception 'Old extracting draft'; end if;
  perform public.delete_invoice_draft('00000000-0000-0000-0000-00000000d004');
  perform public.delete_invoice_draft('00000000-0000-0000-0000-00000000d005');
  if exists (select from public.invoice_drafts
    where id in ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000d005')) then
    raise exception 'Deletable drafts are still there';
  end if;

  -- Storage policy: now only the orphans (drafts 1 and 3) can be deleted; the
  -- approved draft's photo stays.
  delete from storage.objects where bucket_id = 'invoices';
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'Expected to delete 3 orphaned photos, deleted %', n; end if;
  if not exists (select from storage.objects
    where bucket_id = 'invoices' and name = '00000000-0000-0000-0000-00000000d006/1.jpg') then
    raise exception 'Approved invoice photo was deleted';
  end if;
end $$;

-- Cashier cannot delete photos either.
reset role;
select set_config('request.jwt.claim.sub', id::text, true)
from public.profiles where role = 'cashier' limit 1;
set local role authenticated;
do $$
declare n integer;
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'invoices';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Cashier deleted invoice photos'; end if;
end $$;

-- Activity: one row per deleted draft, with the invoice number.
reset role;
do $$
begin
  if (select count(*) from public.activity_log where action = 'invoice_draft_deleted'
      and entity_id in ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d003',
                        '00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000d005')) <> 4 then
    raise exception 'Deleted drafts were not logged';
  end if;
  if (select details ->> 'invoice_number' from public.activity_log
      where action = 'invoice_draft_deleted' and entity_id = '00000000-0000-0000-0000-00000000d001') <> 'DEL-READY' then
    raise exception 'Activity row lacks the invoice number';
  end if;
  if exists (select from public.activity_log where action = 'invoice_draft_deleted'
      and entity_id in ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000d006')) then
    raise exception 'A refused delete was logged';
  end if;
end $$;

rollback;
