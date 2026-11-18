import { productsSource } from "@/src/lib/products/queries";
import { supabase } from "@/src/lib/supabase/client";

import type { PendingSale } from "@/src/lib/sales/offlineQueue";

export type PaymentMethod = "cash" | "card" | "credit";

// balance_cents: what the customer owes (credit not yet repaid); absent on a
// customer just created, who owes nothing.
export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  balance_cents?: number;
};

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
  cashier_id?: string;
  voided_at: string | null;
  void_reason: string | null;
  // The real sale time (an offline sale is stamped on the device).
  occurred_at?: string | null;
  // Names for the history rows; null when unknown or not readable.
  customer_name?: string | null;
  cashier_name?: string | null;
};

// One line of a sale as the history shows it. No cost column, ever: a cashier
// must not see it, and the history has no use for it.
export type SaleLine = {
  id: string;
  sale_id: string;
  product_name: string | null;
  unit: string | null;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
  line_total_cents: number;
};

// The part of the payload both record_sale and recover_sale take.
function salePayload(sale: PendingSale) {
  return {
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
  };
}

export async function submitSale(sale: PendingSale): Promise<void> {
  const { error, status } = await supabase.rpc("record_sale", {
    ...salePayload(sale),
    // An assertion, not a claim: the server credits the caller's session and
    // refuses the sale if that is not this user (audit C05). Legacy sales have
    // no user id and are never sent here.
    p_expected_cashier: sale.cashier_id ?? null,
  });
  if (error)
    throw new Error(
      [502, 503, 504].includes(status) ? `${status} ${error.message}` : error.message
    );
}

// Owner only. Records a sale stranded on this device by a user who cannot sign
// back in: credited to the owner, flagged recovered-by-owner, with the original
// cashier (null if unknown) kept in the activity log. True = recovered now;
// false = it was already on the server, nothing changed.
export async function recoverSale(sale: PendingSale): Promise<boolean> {
  const { data, error } = await supabase.rpc("recover_sale", {
    ...salePayload(sale),
    p_original_cashier_id: sale.cashier_id ?? null,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

// Names for the recovery list. The owner can read every profile.
export async function fetchCashierNames(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", ids);
  if (error) throw new Error(error.message);
  const names: Record<string, string> = {};
  for (const row of (data ?? []) as { id: string; full_name: string | null }[]) {
    if (row.full_name) names[row.id] = row.full_name;
  }
  return names;
}

export async function fetchCustomers(): Promise<Customer[]> {
  // The balances view (cashiers may read it) so the counter sees who owes what.
  const { data, error } = await supabase
    .from("customer_balances")
    .select("id, name, phone, balance_cents")
    .order("name");
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

type SaleRow = Omit<SaleSummary, "customer_name" | "cashier_name"> & {
  customers: { name: string } | null;
  profiles: { full_name: string | null } | null;
};

// One page of the history, newest first. Visibility is unchanged: RLS shows a
// cashier their own sales and the owner everyone's. The customer and cashier
// names ride along as embedded selects (a cashier can only read their own
// profile, which is exactly the sales they can see).
export async function fetchRecentSales(limit = 50, offset = 0): Promise<SaleSummary[]> {
  const { data, error } = await supabase
    .from("sales")
    .select(
      "id, created_at, occurred_at, payment_method, total_cents, discount_cents, customer_id, cashier_id, voided_at, void_reason, customers(name), profiles!sales_cashier_id_fkey(full_name)"
    )
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as SaleRow[]).map(({ customers, profiles, ...sale }) => ({
    ...sale,
    customer_name: customers?.name ?? null,
    cashier_name: profiles?.full_name ?? null,
  }));
}

// Lines for a batch of sales, with product names. Owner reads sale_items, a
// cashier the cashier view; neither query selects a cost column.
export async function fetchSaleLines(saleIds: string[], isOwner: boolean): Promise<SaleLine[]> {
  if (saleIds.length === 0) return [];
  const { data, error } = await supabase
    .from(isOwner ? "sale_items" : "sale_items_cashier_view")
    .select("id, sale_id, product_id, quantity, unit_price_cents, discount_cents, line_total_cents")
    .in("sale_id", saleIds)
    .order("created_at");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as (Omit<SaleLine, "product_name" | "unit"> & {
    product_id: string;
  })[];

  const productIds = [...new Set(rows.map((r) => r.product_id))];
  const names = new Map<string, { name: string; unit: string }>();
  if (productIds.length > 0) {
    const { data: products, error: productError } = await supabase
      .from(productsSource(isOwner))
      .select("id, name, unit")
      .in("id", productIds);
    if (productError) throw new Error(productError.message);
    for (const p of (products ?? []) as unknown as { id: string; name: string; unit: string }[]) {
      names.set(p.id, p);
    }
  }
  return rows.map(({ product_id, ...line }) => ({
    ...line,
    quantity: Number(line.quantity),
    product_name: names.get(product_id)?.name ?? null,
    unit: names.get(product_id)?.unit ?? null,
  }));
}

export async function voidSale(saleId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("void_sale", {
    p_sale_id: saleId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}
