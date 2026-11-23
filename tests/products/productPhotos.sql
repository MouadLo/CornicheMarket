-- Product photos (migration 053). Runs in CI after `supabase db reset`, as
-- postgres. Everything is rolled back. The seed has an owner 'aa' and a cashier 'bb'.
begin;

insert into public.products (id, name, selling_price_cents, unit) values
  ('53000000-0000-0000-0000-000000000001', 'Photo test A', 1000, 'piece'),
  ('53000000-0000-0000-0000-000000000002', 'Photo test B', 500, 'piece');

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end;
$$;
create function pg_temp.expect(p_label text, p_got text, p_want text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception '%: got %, wanted %', p_label, coalesce(p_got, 'success'), coalesce(p_want, 'success');
  end if;
end;
$$;

do $$
declare
  owner_id constant uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id constant uuid := '00000000-0000-0000-0000-0000000000bb';
  pa constant uuid := '53000000-0000-0000-0000-000000000001';
  pb constant uuid := '53000000-0000-0000-0000-000000000002';
  f1 constant text := '53000000-0000-0000-0000-000000000001/11111111-1111-1111-1111-111111111111.jpg';
  f2 constant text := '53000000-0000-0000-0000-000000000001/22222222-2222-2222-2222-222222222222.webp';
  fb constant text := '53000000-0000-0000-0000-000000000002/33333333-3333-3333-3333-333333333333.jpg';
  v_old text;
  v_n bigint;
  v_path text;
begin
  ---------------------------------------------------------------- bucket
  perform pg_temp.expect('bucket private', (select public::text from storage.buckets where id = 'product-photos'), 'false');
  perform pg_temp.expect('bucket limit', (select file_size_limit::text from storage.buckets where id = 'product-photos'), '2097152');
  perform pg_temp.expect('bucket mime', (select allowed_mime_types::text from storage.buckets where id = 'product-photos'),
    '{image/jpeg,image/png,image/webp}');

  ---------------------------------------------------------------- owner uploads
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  insert into storage.objects (bucket_id, name) values ('product-photos', f1), ('product-photos', f2), ('product-photos', fb);
  perform pg_temp.expect('owner upload for unknown product',
    pg_temp.sqlstate_of(format($f$insert into storage.objects (bucket_id, name) values ('product-photos', %L)$f$,
      '53000000-0000-0000-0000-0000000000ff/44444444-4444-4444-4444-444444444444.jpg')), '42501');

  -- set
  perform pg_temp.expect('first set returns no old path', public.set_product_photo(pa, f1), null);
  perform pg_temp.expect('path stored', (select photo_path from public.products where id = pa), f1);
  perform pg_temp.expect('timestamp stored', (select (photo_updated_at is not null)::text from public.products where id = pa), 'true');
  -- replace returns the old path
  perform pg_temp.expect('replace returns old', public.set_product_photo(pa, f2), f1);
  -- same path again: nothing to delete
  perform pg_temp.expect('same path returns null', public.set_product_photo(pa, f2), null);
  -- validation
  perform pg_temp.expect('other product folder', pg_temp.sqlstate_of(format('select public.set_product_photo(%L, %L)', pa, fb)), '22023');
  perform pg_temp.expect('missing object', pg_temp.sqlstate_of(format('select public.set_product_photo(%L, %L)', pa,
    '53000000-0000-0000-0000-000000000001/55555555-5555-5555-5555-555555555555.jpg')), '22023');
  perform pg_temp.expect('bad extension', pg_temp.sqlstate_of(format('select public.set_product_photo(%L, %L)', pa,
    '53000000-0000-0000-0000-000000000001/11111111-1111-1111-1111-111111111111.gif')), '22023');
  perform pg_temp.expect('path traversal', pg_temp.sqlstate_of(format('select public.set_product_photo(%L, %L)', pa,
    '53000000-0000-0000-0000-000000000001/../x.jpg')), '22023');

  ---------------------------------------------------------------- cashier
  reset role;
  perform pg_temp.as_user(cashier_id);
  set local role authenticated;
  perform pg_temp.expect('cashier cannot set', pg_temp.sqlstate_of(format('select public.set_product_photo(%L, %L)', pb, fb)), '42501');
  perform pg_temp.expect('cashier cannot clear', pg_temp.sqlstate_of(format('select public.clear_product_photo(%L)', pa)), '42501');
  perform pg_temp.expect('cashier cannot update column',
    pg_temp.sqlstate_of(format('update public.products set photo_path = %L where id = %L', fb, pb)), '42501');
  select photo_path into v_path from public.products_cashier_view where id = pa;
  perform pg_temp.expect('cashier reads photo_path via view', v_path, f2);
  perform pg_temp.expect('cashier selects bucket objects', (select count(*)::text from storage.objects where bucket_id = 'product-photos'), '3');
  perform pg_temp.expect('cashier cannot insert object',
    pg_temp.sqlstate_of(format($f$insert into storage.objects (bucket_id, name) values ('product-photos', %L)$f$,
      '53000000-0000-0000-0000-000000000002/66666666-6666-6666-6666-666666666666.jpg')), '42501');
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'product-photos';
  get diagnostics v_n = row_count;
  perform pg_temp.expect('cashier cannot delete objects', v_n::text, '0');
  update storage.objects set name = name || 'x' where bucket_id = 'product-photos';
  get diagnostics v_n = row_count;
  perform pg_temp.expect('cashier cannot update objects', v_n::text, '0');

  ---------------------------------------------------------------- deactivated cashier reads nothing
  reset role;
  update public.profiles set deactivated_at = now() where id = cashier_id;
  perform pg_temp.as_user(cashier_id);
  set local role authenticated;
  perform pg_temp.expect('deactivated cashier sees no objects',
    (select count(*)::text from storage.objects where bucket_id = 'product-photos'), '0');
  reset role;
  update public.profiles set deactivated_at = null where id = cashier_id;

  ---------------------------------------------------------------- anon
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  perform pg_temp.expect('anon sees no objects',
    (select count(*)::text from storage.objects where bucket_id = 'product-photos'), '0');
  perform pg_temp.expect('anon cannot insert',
    pg_temp.sqlstate_of(format($f$insert into storage.objects (bucket_id, name) values ('product-photos', %L)$f$, fb)), '42501');
  perform pg_temp.expect('anon cannot set', pg_temp.sqlstate_of(format('select public.set_product_photo(%L, %L)', pb, fb)), '42501');
  reset role;

  ---------------------------------------------------------------- owner clears
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  perform pg_temp.expect('clear returns old', public.clear_product_photo(pa), f2);
  perform pg_temp.expect('cleared', (select coalesce(photo_path, 'none') from public.products where id = pa), 'none');
  perform pg_temp.expect('clear again returns null', public.clear_product_photo(pa), null);
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'product-photos' and name = f2;
  get diagnostics v_n = row_count;
  perform pg_temp.expect('owner deletes the old file', v_n::text, '1');
  reset role;
end $$;

rollback;
