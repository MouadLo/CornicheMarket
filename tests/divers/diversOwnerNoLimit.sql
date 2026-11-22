-- Divers: the owner has no maximum amount (migration 049). Runs in CI after
-- `supabase db reset`, as postgres. Every write is rolled back. The seed has an
-- owner 'aa' and a cashier 'bb'.
begin;

delete from public.day_closes;

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.sid(p_n int) returns uuid language sql as $$
  select ('5d000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
$$;
-- Sells one Divers line as the given user. Returns null when the sale was
-- accepted, otherwise the SQLSTATE the server refused it with.
create function pg_temp.divers(p_n int, p_user uuid, p_qty numeric, p_price bigint, p_note text default null)
returns text language plpgsql as $$
declare
  v_product uuid;
  v_line jsonb;
begin
  select id into v_product from public.products where kind = 'misc';
  v_line := jsonb_build_object('product_id', v_product, 'quantity', p_qty, 'unit_price_cents', p_price);
  if p_note is not null then v_line := v_line || jsonb_build_object('note', p_note); end if;
  perform pg_temp.as_user(p_user);
  perform public.record_sale(pg_temp.sid(p_n), null, 'cash'::public.payment_method, 0,
                             jsonb_build_array(v_line), now(), null, null);
  return null;
exception when others then
  return sqlstate;
end;
$$;
-- Refused, whichever rule caught it.
create function pg_temp.refused(p_label text, p_got text) returns void language plpgsql as $$
begin
  if p_got is null then raise exception '%: accepted, wanted a refusal', p_label; end if;
end;
$$;
create function pg_temp.expect(p_label text, p_got text, p_want text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception '%: got %, wanted %', p_label, coalesce(p_got, 'accepted'), coalesce(p_want, 'accepted');
  end if;
end;
$$;

update public.store_settings set divers_max_cents = 20000;

do $$
declare
  owner_id constant uuid := '00000000-0000-0000-0000-0000000000aa';
  cashier_id constant uuid := '00000000-0000-0000-0000-0000000000bb';
  v_stock numeric;
begin
  -- The owner has no maximum: 500 DH is accepted and recorded as typed.
  perform pg_temp.expect('owner 500 DH', pg_temp.divers(1, owner_id, 1, 50000, 'big'), null);
  if (select unit_price_cents from public.sale_items where sale_id = pg_temp.sid(1)) is distinct from 50000 then
    raise exception 'owner 500 DH was not recorded as typed';
  end if;

  -- A cashier is still held to the maximum: 500 DH refused, exactly 200 DH accepted.
  perform pg_temp.expect('cashier 500 DH', pg_temp.divers(2, cashier_id, 1, 50000), '22023');
  perform pg_temp.expect('cashier 200.01 DH', pg_temp.divers(3, cashier_id, 1, 20001), '22023');
  perform pg_temp.expect('cashier 200 DH', pg_temp.divers(4, cashier_id, 1, 20000), null);

  -- A lowered maximum follows the cashier, never the owner.
  update public.store_settings set divers_max_cents = 5000;
  perform pg_temp.expect('cashier 100 DH over a 50 DH maximum', pg_temp.divers(5, cashier_id, 1, 10000), '22023');
  perform pg_temp.expect('owner 100 DH over a 50 DH maximum', pg_temp.divers(6, owner_id, 1, 10000), null);
  update public.store_settings set divers_max_cents = 20000;

  -- Everything else is enforced for the owner too.
  perform pg_temp.expect('owner 0', pg_temp.divers(7, owner_id, 1, 0), '22023');
  -- (A negative price is caught by the line-discount rule before the Divers one.)
  perform pg_temp.refused('owner negative', pg_temp.divers(8, owner_id, 1, -100));
  perform pg_temp.expect('owner quantity 2', pg_temp.divers(9, owner_id, 2, 1000), '22023');
  perform pg_temp.expect('owner note of 61 characters', pg_temp.divers(10, owner_id, 1, 1000, repeat('x', 61)), '22023');
  perform pg_temp.expect('owner note of 60 characters', pg_temp.divers(11, owner_id, 1, 1000, repeat('x', 60)), null);
  perform pg_temp.expect('cashier 0', pg_temp.divers(12, cashier_id, 1, 0), '22023');
  perform pg_temp.expect('cashier quantity 2', pg_temp.divers(13, cashier_id, 2, 1000), '22023');

  -- Refused sales left nothing behind.
  if exists (select 1 from public.sales where id in (pg_temp.sid(2), pg_temp.sid(3), pg_temp.sid(7), pg_temp.sid(8), pg_temp.sid(9), pg_temp.sid(10))) then
    raise exception 'a refused Divers sale was recorded';
  end if;

  -- Divers tracks no stock.
  select stock_quantity into v_stock from public.products where kind = 'misc';
  if v_stock is distinct from 0 then
    raise exception 'Divers stock changed: %', v_stock;
  end if;
end $$;

rollback;
