-- A customer's credit sales, for every signed-in staff member.
--
-- The sales table is private to the cashier who rang a sale up (RLS: cashier_id
-- = auth.uid() or owner), so a cashier opening a customer saw a balance with no
-- sale behind it. The owner decided a cashier must see that the customer already
-- owes money, whoever rang the sale up. This read-only function gives exactly
-- that and nothing more: no cost, profit, line data, discount detail or void
-- reason. The RLS policy on public.sales is NOT widened; product lines stay
-- private to the person who made the sale (and the owner).

create function public.customer_credit_sales(
  p_customer_id uuid,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  occurred_at timestamptz,
  created_at timestamptz,
  total_cents bigint,
  voided_at timestamptz,
  cashier_name text,
  is_own boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor and p.role in ('owner', 'cashier')
  ) then
    raise exception 'Authenticated staff required' using errcode = '42501';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'Offset must not be negative' using errcode = '22023';
  end if;

  return query
  select s.id,
         s.occurred_at,
         s.created_at,
         s.total_cents,
         s.voided_at,
         nullif(btrim(pr.full_name), ''),
         s.cashier_id = v_actor
  from public.sales s
  left join public.profiles pr on pr.id = s.cashier_id
  where s.customer_id = p_customer_id
    and s.payment_method = 'credit'
  order by s.occurred_at desc, s.id desc
  limit v_limit offset p_offset;
end;
$$;

revoke all on function public.customer_credit_sales(uuid, integer, integer) from public, anon;
grant execute on function public.customer_credit_sales(uuid, integer, integer) to authenticated;
