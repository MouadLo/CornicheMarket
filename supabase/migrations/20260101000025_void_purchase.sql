-- Voiding a delivery (docs/STOCK-IN-DESIGN.md 2.1.1, build step R5).
--
-- Until now a wrong delivery (a cost or quantity typo) had no fix: an
-- adjustment corrects stock but leaves the average cost wrong forever, and
-- deleting the purchase row erased the record while leaving stock and
-- average cost exactly as wrong as before. Voiding is the fix:
--
--   * the purchase row stays, marked with who, when and why;
--   * every sale keeps the unit_cost_cents it was stamped with, so profit
--     already reported does not move;
--   * stock goes down by the voided quantity (even below zero);
--   * the average cost going forward is recomputed by taking the voided
--     line's money out of the stock value, or, when that can't give a
--     sensible number, restored to the cost recorded just before the line
--     was received.
--
-- Stock and cost still change only inside triggers: voiding sets
-- voided_at, and apply_purchase_void (below) does the arithmetic.
--
-- Numbered 025: 022-023 belong to the in-progress shelf-count work.

alter table purchases
  add column voided_at timestamptz,
  add column voided_by uuid references profiles (id),
  add column void_reason text,
  add constraint purchases_void_consistent check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and nullif(btrim(void_reason), '') is not null)
  );

-- ---------------------------------------------------------------------------
-- The one formula. Used by the trigger that applies a void and by the preview
-- that the confirmation dialog shows, so the dialog can't promise something
-- the void then doesn't do.
--
--   S' = S - q
--   S' > 0 and S*W - q*c > 0  ->  W' = round((S*W - q*c) / S')
--   otherwise                 ->  W' = the cost before the line was received
-- ---------------------------------------------------------------------------
create function public.void_line_effect(
  p_stock numeric,        -- S: stock now
  p_cost bigint,          -- W: average cost now
  p_quantity numeric,     -- q: the voided line's quantity
  p_unit_cost bigint,     -- c: the voided line's unit cost
  p_cost_before bigint    -- the average cost just before the line was received
)
returns table (new_stock numeric, new_cost bigint)
language sql
immutable
as $$
  select
    p_stock - p_quantity,
    case
      when p_stock - p_quantity > 0 and p_stock * p_cost - p_quantity * p_unit_cost > 0
        then round((p_stock * p_cost - p_quantity * p_unit_cost) / (p_stock - p_quantity))::bigint
      else p_cost_before
    end;
$$;

revoke all on function public.void_line_effect(numeric, bigint, numeric, bigint, bigint) from public;

-- ---------------------------------------------------------------------------
-- Guard: who may void, with what, and that a void is final.
-- Runs for the RPC and for any direct update of the row alike, so there is
-- no way to void without an owner and a reason, or to undo or rewrite one.
-- ---------------------------------------------------------------------------
create function public.guard_purchase_void()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.voided_at is not null then
    if new.voided_at is distinct from old.voided_at
       or new.voided_by is distinct from old.voided_by
       or new.void_reason is distinct from old.void_reason then
      raise exception 'A voided delivery cannot be changed' using errcode = 'CM410';
    end if;
  elsif new.voided_at is not null then
    if auth.uid() is null or not public.is_owner() then
      raise exception 'Only the owner can void a delivery' using errcode = '42501';
    end if;
    if nullif(btrim(coalesce(new.void_reason, '')), '') is null then
      raise exception 'A void needs a reason' using errcode = '22023';
    end if;
    new.voided_at := now();
    new.voided_by := auth.uid();
    new.void_reason := btrim(new.void_reason);
  end if;
  return new;
end;
$$;

create trigger trg_purchases_guard_void
  before update on purchases
  for each row execute function public.guard_purchase_void();

-- A voided delivery can't take more lines: that would add stock to a record
-- that no longer counts.
create function public.refuse_item_on_voided_purchase()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (select 1 from purchases where id = new.purchase_id and voided_at is not null) then
    raise exception 'This delivery was voided' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger trg_purchase_items_refuse_voided
  before insert on purchase_items
  for each row execute function public.refuse_item_on_voided_purchase();

-- ---------------------------------------------------------------------------
-- The arithmetic: the fourth trigger allowed to touch products.stock_quantity
-- and products.current_cost_cents. Lines are taken in the order they were
-- received, so two lines of one product chain correctly. Past sale_items are
-- never read or written.
-- ---------------------------------------------------------------------------
create function public.apply_purchase_void()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_line record;
  v_stock numeric;
  v_cost bigint;
  v_before bigint;
  v_effect record;
begin
  for v_line in
    select pi.id, pi.product_id, pi.quantity, pi.unit_cost_cents, pi.created_at
    from purchase_items pi
    where pi.purchase_id = new.id
    order by pi.created_at, pi.id
  loop
    select p.stock_quantity, p.current_cost_cents into v_stock, v_cost
    from products p
    where p.id = v_line.product_id
    for update;

    -- The cost in force before this line was received: the latest cost_history
    -- row strictly older than the line itself. A product with no earlier
    -- history never had a cost, so 0.
    select ch.cost_cents into v_before
    from cost_history ch
    where ch.product_id = v_line.product_id and ch.effective_at < v_line.created_at
    order by ch.effective_at desc, ch.id desc
    limit 1;

    select * into v_effect
    from public.void_line_effect(v_stock, v_cost, v_line.quantity, v_line.unit_cost_cents, coalesce(v_before, 0));

    update products
    set stock_quantity = v_effect.new_stock,
        current_cost_cents = v_effect.new_cost
    where id = v_line.product_id;

    insert into cost_history (product_id, cost_cents, source, purchase_item_id)
    values (v_line.product_id, v_effect.new_cost, 'purchase_void', v_line.id);
  end loop;

  return null;
end;
$$;

create trigger trg_purchases_after_void
  after update of voided_at on purchases
  for each row
  when (old.voided_at is null and new.voided_at is not null)
  execute function public.apply_purchase_void();

-- ---------------------------------------------------------------------------
-- The RPC. Idempotent: voiding an already voided delivery changes nothing and
-- returns false.
-- ---------------------------------------------------------------------------
create function public.void_purchase(p_purchase_id uuid, p_reason text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_voided_at timestamptz;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception 'Only the owner can void a delivery' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'A void needs a reason' using errcode = '22023';
  end if;

  select pu.voided_at into v_voided_at
  from purchases pu
  where pu.id = p_purchase_id
  for update;
  if not found then
    raise exception 'Unknown delivery' using errcode = '22023';
  end if;
  if v_voided_at is not null then
    return false;
  end if;

  update purchases
  set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
  where id = p_purchase_id;
  return true;
end;
$$;

revoke all on function public.void_purchase(uuid, text) from public;
grant execute on function public.void_purchase(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Read-only preview for the confirmation dialog: per line, the stock and
-- average cost before and after, chained in the same order the void applies
-- them. Changes nothing. An already voided delivery has nothing to preview.
-- ---------------------------------------------------------------------------
create function public.preview_void_purchase(p_purchase_id uuid)
returns table (
  product_id uuid,
  product_name text,
  unit text,
  quantity numeric,
  unit_cost_cents bigint,
  stock_before numeric,
  stock_after numeric,
  cost_before_cents bigint,
  cost_after_cents bigint
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_voided_at timestamptz;
  v_line record;
  v_state jsonb := '{}'::jsonb;
  v_key text;
  v_stock numeric;
  v_cost bigint;
  v_before bigint;
  v_effect record;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception 'Only the owner can void a delivery' using errcode = '42501';
  end if;

  select pu.voided_at into v_voided_at from purchases pu where pu.id = p_purchase_id;
  if not found then
    raise exception 'Unknown delivery' using errcode = '22023';
  end if;
  if v_voided_at is not null then
    return;
  end if;

  for v_line in
    select pi.id as line_id, pi.product_id as line_product_id, pi.quantity as line_quantity,
           pi.unit_cost_cents as line_unit_cost, pi.created_at as line_created_at,
           pr.name as line_product_name, pr.unit::text as line_unit,
           pr.stock_quantity as current_stock, pr.current_cost_cents as current_cost
    from purchase_items pi
    join products pr on pr.id = pi.product_id
    where pi.purchase_id = p_purchase_id
    order by pi.created_at, pi.id
  loop
    v_key := v_line.line_product_id::text;
    if v_state ? v_key then
      v_stock := (v_state -> v_key ->> 'stock')::numeric;
      v_cost := (v_state -> v_key ->> 'cost')::bigint;
    else
      v_stock := v_line.current_stock;
      v_cost := v_line.current_cost;
    end if;

    select ch.cost_cents into v_before
    from cost_history ch
    where ch.product_id = v_line.line_product_id and ch.effective_at < v_line.line_created_at
    order by ch.effective_at desc, ch.id desc
    limit 1;

    select * into v_effect
    from public.void_line_effect(v_stock, v_cost, v_line.line_quantity, v_line.line_unit_cost, coalesce(v_before, 0));

    v_state := v_state || jsonb_build_object(
      v_key, jsonb_build_object('stock', v_effect.new_stock, 'cost', v_effect.new_cost)
    );

    product_id := v_line.line_product_id;
    product_name := v_line.line_product_name;
    unit := v_line.line_unit;
    quantity := v_line.line_quantity;
    unit_cost_cents := v_line.line_unit_cost;
    stock_before := v_stock;
    stock_after := v_effect.new_stock;
    cost_before_cents := v_cost;
    cost_after_cents := v_effect.new_cost;
    return next;
  end loop;
end;
$$;

revoke all on function public.preview_void_purchase(uuid) from public;
grant execute on function public.preview_void_purchase(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A delivery can no longer be deleted: the silent path that left stock and
-- average cost wrong and erased the evidence. Voiding is the only way out.
-- ---------------------------------------------------------------------------
drop policy "owner deletes purchases" on purchases;

-- ---------------------------------------------------------------------------
-- Views. History keeps voided deliveries (struck through, with who and why);
-- totals and the expiring list leave them out. create or replace view can
-- only append columns, so the new ones go last.
-- ---------------------------------------------------------------------------
create or replace view purchase_summaries as
select
  p.id,
  p.purchase_date,
  p.notes,
  p.supplier_id,
  s.name as supplier_name,
  coalesce(round(sum(pi.quantity * pi.unit_cost_cents)), 0)::bigint as total_cents,
  count(pi.id) as line_count,
  p.voided_at,
  p.void_reason,
  vp.full_name as voided_by_name
from purchases p
left join suppliers s on s.id = p.supplier_id
left join profiles vp on vp.id = p.voided_by
left join purchase_items pi on pi.purchase_id = p.id
where public.is_owner()
group by p.id, s.name, vp.id;

create or replace view purchase_monthly_totals as
select
  date_trunc('month', p.purchase_date) as month,
  coalesce(round(sum(pi.quantity * pi.unit_cost_cents)), 0)::bigint as total_cents,
  count(distinct p.id) as purchase_count
from purchases p
left join purchase_items pi on pi.purchase_id = p.id
where public.is_owner() and p.voided_at is null
group by date_trunc('month', p.purchase_date);

create or replace view purchase_supplier_totals as
select
  p.supplier_id,
  coalesce(s.name, 'No supplier') as supplier_name,
  coalesce(round(sum(pi.quantity * pi.unit_cost_cents)), 0)::bigint as total_cents,
  count(distinct p.id) as purchase_count
from purchases p
left join suppliers s on s.id = p.supplier_id
left join purchase_items pi on pi.purchase_id = p.id
where public.is_owner() and p.voided_at is null
group by p.supplier_id, s.name;

create or replace view expiring_batches as
select
  pi.id,
  pi.product_id,
  p.name as product_name,
  p.unit,
  p.stock_quantity,
  pi.quantity as delivered_quantity,
  pi.expiry_date,
  (pi.expiry_date - current_date) as days_left
from purchase_items pi
join products p on p.id = pi.product_id
join purchases pu on pu.id = pi.purchase_id
where pi.expiry_date is not null
  and p.active
  and pu.voided_at is null;
