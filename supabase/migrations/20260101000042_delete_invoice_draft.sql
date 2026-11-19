-- The owner can delete an invoice draft that was never approved, and its photos.
--
-- Deletable: a draft with no purchase (status ready, failed, or extracting).
-- A draft still 'extracting' only once extraction started more than 2 minutes
-- ago (or never recorded a start), so it cannot race the extract-invoice
-- function. An approved draft is never deleted: its photos are the record of
-- the delivery. Nothing else references invoice_drafts (purchases do not point
-- back at it; only the draft points at its purchase), so deleting an
-- unapproved draft leaves no dangling reference.
--
-- Error codes the app tells apart:
--   CM404  no such draft (already deleted?)
--   CM413  already approved: cannot be deleted
--   CM415  still being read: try again in a couple of minutes
--   42501  not the owner
--
-- The function returns the draft's photo paths. Files must be removed through
-- the Storage API (never by deleting storage.objects rows from SQL), so the
-- app removes them right after, which the policy below allows only for files
-- that no longer belong to any draft.

create function public.delete_invoice_draft(p_id uuid) returns text[]
language plpgsql security definer set search_path = ''
as $$
declare
  v_draft public.invoice_drafts%rowtype;
  v_supplier text;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception 'Only an owner can delete invoice drafts' using errcode = '42501';
  end if;

  select * into v_draft from public.invoice_drafts where id = p_id for update;
  if not found then
    raise exception 'Invoice draft not found' using errcode = 'CM404';
  end if;
  if v_draft.purchase_id is not null or v_draft.approved_at is not null then
    raise exception 'An approved invoice cannot be deleted' using errcode = 'CM413';
  end if;
  if v_draft.status = 'extracting'
    and v_draft.extraction_started_at is not null
    and v_draft.extraction_started_at > now() - interval '2 minutes' then
    raise exception 'The invoice is still being read' using errcode = 'CM415';
  end if;

  select name into v_supplier from public.suppliers where id = v_draft.supplier_id;

  insert into public.activity_log (actor_id, action, entity_id, details)
  values (
    auth.uid(),
    'invoice_draft_deleted',
    v_draft.id,
    jsonb_build_object(
      'invoice_number', v_draft.invoice_number,
      'supplier_name', coalesce(v_supplier, v_draft.extraction ->> 'supplier_name'),
      'status', v_draft.status,
      'photo_count', cardinality(v_draft.photo_paths)
    )
  );

  delete from public.invoice_drafts where id = v_draft.id;
  return v_draft.photo_paths;
end;
$$;
revoke all on function public.delete_invoice_draft(uuid) from public, anon, authenticated;
grant execute on function public.delete_invoice_draft(uuid) to authenticated;

-- The owner may delete an invoice photo only once its draft is gone: no draft
-- row has the folder's id, and no draft lists the path. A photo of a draft that
-- still exists (approved or not, recorded or still uploading) can never be
-- deleted through the Storage API.
create policy "owners delete orphaned invoice photos" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'invoices' and (select public.is_owner())
    and not exists (
      select 1 from public.invoice_drafts d
      where d.id::text = (storage.foldername(name))[1]
        or name = any (d.photo_paths)
    )
  );
