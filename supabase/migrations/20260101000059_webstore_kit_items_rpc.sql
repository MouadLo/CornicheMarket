-- Webstore: replace the lines of one kit atomically (migration 059).
--
-- The app used to delete a kit's lines and insert the new ones in two calls: a
-- failure in between left the kit empty. save_web_kit_items does both in one
-- transaction. The existing triggers bump the feed version.
--
-- p_items: [{"id": "<web product id>", "qty": 1..10}, ...] in the order wanted;
-- sort becomes position * 10. At most 12 lines (the page reads 12), no duplicate
-- id. The id is not checked against web_products on purpose (see migration 054).
--
-- Errors (SQLSTATE): 42501 not the owner, P0002 unknown kit, 22023 invalid lines.

create function public.save_web_kit_items(p_kit_id text, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'only the owner can change kits' using errcode = '42501';
  end if;
  if not exists (select 1 from public.web_kits k where k.id = p_kit_id) then
    raise exception 'kit % does not exist', p_kit_id using errcode = 'P0002';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 12 then
    raise exception 'a kit holds 12 lines at most' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) e
    where jsonb_typeof(e) <> 'object'
       or jsonb_typeof(e -> 'id') is distinct from 'string'
       or (e ->> 'id') !~ '^[A-Za-z0-9_-]{1,20}$'
       or jsonb_typeof(e -> 'qty') is distinct from 'number'
       or (e ->> 'qty') !~ '^([1-9]|10)$'
  ) then
    raise exception 'invalid kit line' using errcode = '22023';
  end if;
  if (select count(distinct e ->> 'id') from jsonb_array_elements(p_items) e)
     <> jsonb_array_length(p_items) then
    raise exception 'duplicate product in the kit' using errcode = '22023';
  end if;

  delete from public.web_kit_items where kit_id = p_kit_id;
  insert into public.web_kit_items (kit_id, web_product_id, qty, sort)
  select p_kit_id, e.value ->> 'id', (e.value ->> 'qty')::int, (e.ordinality::int) * 10
  from jsonb_array_elements(p_items) with ordinality as e(value, ordinality);
end;
$$;

revoke all on function public.save_web_kit_items(text, jsonb) from public, anon;
grant execute on function public.save_web_kit_items(text, jsonb) to authenticated;
