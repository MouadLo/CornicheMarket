import { supabase } from "@/src/lib/supabase/client";

import type { PendingSale } from "@/src/lib/sales/offlineQueue";

export type PaymentMethod = "cash" | "card" | "credit";

export type Customer = { id: string; name: string; phone: string | null };

export type CustomerBalance = {
  id: string;
  name: string;
  phone: string | null;
  credit_total_cents: number;
  paid_total_cents: number;
  balance_cents: number;
};

export type SaleSummary = {
  id: string;
  created_at: string;
  payment_method: PaymentMethod;
  total_cents: number;
  discount_cents: number;
  customer_id: string | null;
  voided_at: string | null;
  void_reason: string | null;
};

export async function submitSale(sale: PendingSale): Promise<void> {
  const { error } = await supabase.rpc("record_sale", {
    p_sale_id: sale.id,
    p_customer_id: sale.customer_id,
    p_payment_method: sale.payment_method,
    p_discount_cents: sale.discount_cents,
    p_lines: sale.lines.map((line) => ({
      product_id: line.product_id,
      quantity: line.quantity,
      unit_price_cents: line.unit_price_cents,
      discount_cents: line.discount_cents,
    })),
    // The real sale time, captured on the device when the cashier completed
    // the sale (see pendingSaleFrom) -- not when this request happens to
    // reach the server, which may be hours later for an offline sale.
    p_occurred_at: sale.created_at,
  });

  if (error) throw new Error(error.message);
}

export async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase.from("customers").select("id, name, phone").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Customer[];
}

export async function createCustomer(name: string, phone: string | null): Promise<Customer> {
  const { data, error } = await supabase
    .from("customers")
    .insert({ name, phone })
    .select("id, name, phone")
    .single();
  if (error) throw new Error(error.message);
  return data as Customer;
}

export async function fetchCustomerBalances(): Promise<CustomerBalance[]> {
  const { data, error } = await supabase
    .from("customer_balances")
    .select("id, name, phone, credit_total_cents, paid_total_cents, balance_cents")
    .order("balance_cents", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerBalance[];
}

// Credit repayments go through record_customer_payment only (migration 026):
// direct inserts are revoked. `paymentId` is generated once per payment and
// reused on retry, so a lost response can't record the money twice.
export async function recordCustomerPayment(
  paymentId: string,
  customerId: string,
  amountCents: number,
  method: PaymentMethod
): Promise<void> {
  const { error } = await supabase.rpc("record_customer_payment", {
    p_payment_id: paymentId,
    p_customer_id: customerId,
    p_amount_cents: amountCents,
    p_method: method,
  });
  if (error) throw new Error(error.message);
}

export async function fetchRecentSales(limit = 50): Promise<SaleSummary[]> {
  const { data, error } = await supabase
    .from("sales")
    .select(
      "id, created_at, payment_method, total_cents, discount_cents, customer_id, voided_at, void_reason"
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as SaleSummary[];
}

export async function voidSale(saleId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("void_sale", {
    p_sale_id: saleId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}
