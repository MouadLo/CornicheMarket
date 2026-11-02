-- The adjustment primary key is the immutable client operation ID. Existing
-- clients can continue using their insert path; new counts use this RPC.
create function public.record_stock_adjustment(
  p_operation_id uuid,
  p_product_id uuid,
  p_quantity_delta numeric,
  p_reason public.adjustment_reason,
  p_note text
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare existing public.stock_adjustments%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_operation_id is null or p_product_id is null or p_quantity_delta is null
     or p_quantity_delta = 0 or p_quantity_delta::text in ('NaN', 'Infinity', '-Infinity')
     or p_quantity_delta <> round(p_quantity_delta, 3) or p_reason is null then
    raise exception 'Invalid adjustment' using errcode = '22023';
  end if;
  -- ON CONFLICT waits for a concurrent insert. The trigger fires only for
  -- the winning insert, and its stock change commits in the same transaction.
  insert into public.stock_adjustments(id, product_id, quantity_delta, reason, note, created_by)
  values (p_operation_id, p_product_id, p_quantity_delta, p_reason, p_note, auth.uid())
  on conflict (id) do nothing;
  select * into existing from public.stock_adjustments where id = p_operation_id;
  if not found or existing.created_by is distinct from auth.uid()
    or existing.product_id is distinct from p_product_id
    or existing.quantity_delta is distinct from p_quantity_delta
    or existing.reason is distinct from p_reason
    or existing.note is distinct from p_note then
    raise exception 'Operation ID already used with another payload' using errcode = '22023';
  end if;
  return p_operation_id;
end;
$$;
revoke all on function public.record_stock_adjustment(uuid, uuid, numeric, public.adjustment_reason, text) from public, anon;
grant execute on function public.record_stock_adjustment(uuid, uuid, numeric, public.adjustment_reason, text) to authenticated;
