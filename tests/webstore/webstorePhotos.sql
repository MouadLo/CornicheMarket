-- Webstore photos (migration 057). Runs in CI after `supabase db reset`, as
-- postgres. Everything is rolled back. The seed has an owner 'aa' and a cashier 'bb'.
begin;

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
-- The image of this product in the feed (null when absent or json null).
create function pg_temp.feed_image(p_id text) returns text language sql as $$
  select e ->> 'image'
  from jsonb_array_elements(public.webstore_feed() -> 'products') e
  where e ->> 'id' = p_id;
$$;

do $$
declare
  owner_id constant uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id constant uuid := '00000000-0000-0000-0000-0000000000bb';
  v_n bigint;
begin
  ---------------------------------------------------------------- bucket
  perform pg_temp.expect('bucket exists', (select count(*)::text from storage.buckets where id = 'webstore-images'), '1');
  perform pg_temp.expect('bucket public', (select public::text from storage.buckets where id = 'webstore-images'), 'true');
  perform pg_temp.expect('bucket limit', (select file_size_limit::text from storage.buckets where id = 'webstore-images'), '2097152');
  perform pg_temp.expect('bucket mime', (select allowed_mime_types::text from storage.buckets where id = 'webstore-images'),
    '{image/jpeg,image/png,image/webp}');
  perform pg_temp.expect('three bucket policies', (select count(*)::text from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname in (
      'owner uploads webstore images', 'owner replaces webstore images', 'owner deletes webstore images')), '3');
  perform pg_temp.expect('no anon or select policy on the bucket', (select count(*)::text from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like '%webstore images%'
      and (cmd = 'SELECT' or 'anon' = any (roles))), '0');

  ---------------------------------------------------------------- owner: columns and checks
  perform pg_temp.as_user(owner_id);
  set local role authenticated;

  insert into public.web_categories (id, name, name_fr, sort) values ('drinks', 'Drinks', 'Boissons', 1);
  insert into public.web_products (id, name, category_id, image_url, published) values
    ('p001', 'Has link', 'drinks', 'https://img.example/a.jpg', true),
    ('p002', 'No picture', 'drinks', null, true);
  perform pg_temp.expect('existing rows default to url',
    (select string_agg(image_source, ',' order by id) from public.web_products), 'url,url');
  perform pg_temp.expect('image_path starts empty', (select count(image_path)::text from public.web_products), '0');

  perform pg_temp.expect('bad path: no folder',
    pg_temp.sqlstate_of($f$update public.web_products set image_path = 'x.jpg' where id = 'p001'$f$), '23514');
  perform pg_temp.expect('bad path: traversal',
    pg_temp.sqlstate_of($f$update public.web_products set image_path = 'p001/../x.jpg' where id = 'p001'$f$), '23514');
  perform pg_temp.expect('bad path: two folders',
    pg_temp.sqlstate_of($f$update public.web_products set image_path = 'p001/a/b.jpg' where id = 'p001'$f$), '23514');
  perform pg_temp.expect('bad path: space',
    pg_temp.sqlstate_of($f$update public.web_products set image_path = 'p001/a b.jpg' where id = 'p001'$f$), '23514');
  perform pg_temp.expect('bad source value',
    pg_temp.sqlstate_of($f$update public.web_products set image_source = 'other' where id = 'p001'$f$), '23514');
  perform pg_temp.expect('source file without a path',
    pg_temp.sqlstate_of($f$update public.web_products set image_source = 'file' where id = 'p001'$f$), '23514');

  ---------------------------------------------------------------- feed image
  perform pg_temp.expect('url source: the link', pg_temp.feed_image('p001'), 'https://img.example/a.jpg');
  perform pg_temp.expect('no picture: null', pg_temp.feed_image('p002'), null);

  -- Uploading a file does not change what the site shows until it is chosen.
  update public.web_products set image_path = 'p001/1700000000000.jpg' where id = 'p001';
  perform pg_temp.expect('path stored but source url: still the link', pg_temp.feed_image('p001'), 'https://img.example/a.jpg');

  update public.web_products set image_source = 'file' where id = 'p001';
  perform pg_temp.expect('file source: the stored file (relative path)', pg_temp.feed_image('p001'),
    '/storage/v1/object/public/webstore-images/p001/1700000000000.jpg');
  perform pg_temp.expect('the link is kept', (select image_url from public.web_products where id = 'p001'), 'https://img.example/a.jpg');

  -- File chosen on a row without a link.
  update public.web_products set image_path = 'p002/1700000000001.jpg', image_source = 'file' where id = 'p002';
  perform pg_temp.expect('file without link', pg_temp.feed_image('p002'),
    '/storage/v1/object/public/webstore-images/p002/1700000000001.jpg');

  -- Back to the link: the file path stays.
  update public.web_products set image_source = 'url' where id = 'p001';
  perform pg_temp.expect('back to the link', pg_temp.feed_image('p001'), 'https://img.example/a.jpg');
  perform pg_temp.expect('the path is kept', (select image_path from public.web_products where id = 'p001'), 'p001/1700000000000.jpg');

  -- Clearing the path while the source is 'file' is refused; clearing both works.
  perform pg_temp.expect('cannot clear the path of a chosen file',
    pg_temp.sqlstate_of($f$update public.web_products set image_path = null where id = 'p002'$f$), '23514');
  update public.web_products set image_path = null, image_source = 'url' where id = 'p002';
  perform pg_temp.expect('file removed: no picture', pg_temp.feed_image('p002'), null);

  -- Source 'url' with no link: the site shows no picture.
  update public.web_products set image_url = null where id = 'p001';
  perform pg_temp.expect('url source without link: null', pg_temp.feed_image('p001'), null);

  ---------------------------------------------------------------- owner uploads files
  perform set_config('storage.allow_delete_query', 'true', true);
  insert into storage.objects (bucket_id, name) values ('webstore-images', 'p001/1700000000000.jpg');
  perform pg_temp.expect('owner sees the object', (select count(*)::text from storage.objects where bucket_id = 'webstore-images'), '1');
  update storage.objects set name = 'p001/1700000000002.jpg' where bucket_id = 'webstore-images';
  get diagnostics v_n = row_count;
  perform pg_temp.expect('owner can update objects', v_n::text, '1');
  delete from storage.objects where bucket_id = 'webstore-images';
  get diagnostics v_n = row_count;
  perform pg_temp.expect('owner can delete objects', v_n::text, '1');
  insert into storage.objects (bucket_id, name) values ('webstore-images', 'p001/1700000000003.jpg');

  ---------------------------------------------------------------- cashier
  reset role;
  perform pg_temp.as_user(cashier_id);
  set local role authenticated;
  perform pg_temp.expect('cashier sees no web products', (select count(*)::text from public.web_products), '0');
  update public.web_products set image_source = 'url', image_path = null;
  get diagnostics v_n = row_count;
  perform pg_temp.expect('cashier update touches nothing', v_n::text, '0');
  perform pg_temp.expect('cashier cannot insert object',
    pg_temp.sqlstate_of($f$insert into storage.objects (bucket_id, name) values ('webstore-images', 'p001/1700000000004.jpg')$f$), '42501');
  delete from storage.objects where bucket_id = 'webstore-images';
  get diagnostics v_n = row_count;
  perform pg_temp.expect('cashier cannot delete objects', v_n::text, '0');
  update storage.objects set name = name || 'x' where bucket_id = 'webstore-images';
  get diagnostics v_n = row_count;
  perform pg_temp.expect('cashier cannot update objects', v_n::text, '0');

  ---------------------------------------------------------------- anon
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  perform pg_temp.expect('anon cannot insert object',
    pg_temp.sqlstate_of($f$insert into storage.objects (bucket_id, name) values ('webstore-images', 'p001/1700000000005.jpg')$f$), '42501');
  perform pg_temp.expect('anon cannot read web products', pg_temp.sqlstate_of('select * from public.web_products'), '42501');
end $$;

rollback;
