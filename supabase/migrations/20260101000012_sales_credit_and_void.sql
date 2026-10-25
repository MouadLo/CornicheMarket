create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  created_at timestamptz not null default now()
);

create table customer_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  method payment_method not null default 'cash',
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

alter table sales
  add column customer_id uuid references customers (id),
  add column voided_at timestamptz,
  add column voided_by uuid references profiles (id),
  add column void_reason text;

create index idx_sales_customer on sales (customer_id) where customer_id is not null;
create index idx_customer_payments_customer on customer_payments (customer_id, created_at desc);

-- ============================================================
-- Recording a sale.
--
-- Offline devices generate the sale id themselves and may retry the same
-- sale after the network returns, so this is idempotent: a second call with
-- the same id does nothing instead of selling the stock twice. Totals are
-- computed here rather than trusted from the client, and it runs as the
-- caller so the existing RLS on sales/sale_items still applies.
-- ============================================================
create function public.record_sale(
  p_sale_id uuid,
  p_customer_id uuid,
  p_payment_method payment_method,
  p_discount_cents bigint,
  p_lines jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_line jsonb;
  v_lines_total bigint;
begin
  -- The total is derived here, from the line inputs, using the same
  -- arithmetic as the sale_items trigger. It has to be known before the
  -- sale row is written: updating a sale afterwards is owner-only under
  -- RLS, so a cashier's update would silently affect zero rows and leave
  -- every one of their sales recorded with a total of zero.
  select coalesce(
    sum(
      ((line ->> 'quantity')::numeric * (line ->> 'unit_price_cents')::bigint)::bigint
      - coalesce((line ->> 'discount_cents')::bigint, 0)
    ),
    0
  )
  into v_lines_total
  from jsonb_array_elements(p_lines) as line;

  insert into sales (id, cashier_id, customer_id, payment_method, discount_cents, total_cents)
  values (
    p_sale_id,
    auth.uid(),
    p_customer_id,
    p_payment_method,
    greatest(0, p_discount_cents),
    greatest(0, v_lines_total - greatest(0, p_discount_cents))
  )
  on conflict (id) do nothing;

  -- Already recorded by an earlier attempt: return quietly, add nothing.
  if not found then
    return p_sale_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into sale_items (sale_id, product_id, quantity, unit_price_cents, discount_cents)
    values (
      p_sale_id,
      (v_line ->> 'product_id')::uuid,
      (v_line ->> 'quantity')::numeric,
      (v_line ->> 'unit_price_cents')::bigint,
      coalesce((v_line ->> 'discount_cents')::bigint, 0)
    );
  end loop;

  return p_sale_id;
end;
$$;

grant execute on function public.record_sale(uuid, uuid, payment_method, bigint, jsonb) to authenticated;

-- ============================================================
-- Voiding a sale: owner only, and it puts the stock back.
-- ============================================================
create function public.void_sale(p_sale_id uuid, p_reason text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only an owner can void a sale';
  end if;

  update sales
  set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
  where id = p_sale_id and voided_at is null;

  -- Already voided, or no such sale: never restore the stock twice.
  if not found then
    return;
  end if;

  -- Aggregated first: a sale may contain the same product on several lines,
  -- and UPDATE ... FROM would otherwise apply only one of them.
  update products p
  set stock_quantity = p.stock_quantity + agg.quantity
  from (
    select product_id, sum(quantity) as quantity
    from sale_items
    where sale_id = p_sale_id
    group by product_id
  ) agg
  where agg.product_id = p.id;
end;
$$;

grant execute on function public.void_sale(uuid, text) to authenticated;

-- ============================================================
-- Who owes what. Credit balances are not cost data, so cashiers may read
-- them: they need to know at the counter.
-- ============================================================
create view customer_balances as
select
  c.id,
  c.name,
  c.phone,
  coalesce(credit.total, 0)::bigint as credit_total_cents,
  coalesce(paid.total, 0)::bigint as paid_total_cents,
  (coalesce(credit.total, 0) - coalesce(paid.total, 0))::bigint as balance_cents
from customers c
left join (
  select customer_id, sum(total_cents) as total
  from sales
  where payment_method = 'credit' and voided_at is null and customer_id is not null
  group by customer_id
) credit on credit.customer_id = c.id
left join (
  select customer_id, sum(amount_cents) as total
  from customer_payments
  group by customer_id
) paid on paid.customer_id = c.id;

grant select on customer_balances to authenticated;

alter table customers enable row level security;
alter table customer_payments enable row level security;

create policy "staff read customers" on customers
  for select using (auth.role() = 'authenticated');
create policy "staff add customers" on customers
  for insert with check (auth.role() = 'authenticated');
create policy "owner updates customers" on customers
  for update using (public.is_owner());
create policy "owner deletes customers" on customers
  for delete using (public.is_owner());

create policy "staff read payments" on customer_payments
  for select using (auth.role() = 'authenticated');
create policy "staff record payments" on customer_payments
  for insert with check (created_by = auth.uid());
create policy "owner manages payments" on customer_payments
  for update using (public.is_owner());
create policy "owner deletes payments" on customer_payments
  for delete using (public.is_owner());
