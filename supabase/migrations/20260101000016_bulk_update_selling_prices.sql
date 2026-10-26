-- Wraps multiple selling-price updates from one delivery in a single
-- transaction: all succeed or all roll back, preventing the partial-update
-- bug where a mid-loop failure leaves some products at the old price and
-- others at the new price.
create or replace function batch_update_selling_prices(
  p_updates jsonb -- array of {product_id: uuid, selling_price_cents: bigint}
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  upd jsonb;
begin
  for upd in select * from jsonb_array_elements(p_updates)
  loop
    update products
    set selling_price_cents = (upd->>'selling_price_cents')::bigint
    where id = (upd->>'product_id')::uuid;
  end loop;
end;
$$;

grant execute on function batch_update_selling_prices(jsonb) to authenticated;
