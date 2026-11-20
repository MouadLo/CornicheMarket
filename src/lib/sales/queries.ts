import { productsSource } from "@/src/lib/products/queries";
import { supabase } from "@/src/lib/supabase/client";

import { DEFAULT_DISCOUNT_LIMITS, type DiscountLimits } from "@/src/lib/sales/discountLimit";
import { DEFAULT_CREDIT_LIMIT_CENTS } from "@/src/lib/sales/creditLimit";
import {
  parseCreditLimitCents,
  saveCachedStoreCreditLimit,
} from "@/src/lib/sales/creditLimitCache";
import { parseDiscountLimits, saveCachedDiscountLimits } from "@/src/lib/sales/discountLimitCache";
import type { PendingSale } from "@/src/lib/sales/offlineQueue";
import type {
  RefundMethod,
  ReturnableLine,
  ReturnReason,
  SaleReturnRecord,
} from "@/src/lib/sales/returns";

export type PaymentMethod = "cash" | "card" | "credit";

// balance_cents: what the customer owes (credit not yet repaid); absent on a
// customer just created, who owes nothing. credit_limit_cents: the customer's
// effective debt limit (their own, else the store default) and
// credit_available_cents the room left under it; both absent on a customer just
// created or cached before the limit existed (the store default applies).
export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  balance_cents?: number;
  credit_limit_cents?: number | null;
  credit_available_cents?: number;
};

export type CustomerBalance = {
  id: string;
  name: string;
  phone: string | null;
  credit_total_cents: number;
  paid_total_cents: number;
  balance_cents: number;
  // The effective debt limit, the room left under it, and the customer's own
  // limit (null = the store default applies).
  credit_limit_cents: number;
  credit_available_cents: number;
  credit_limit_override_cents: number | null;
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
    .select("id, name, phone, balance_cents, credit_limit_cents, credit_available_cents")
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
    .select(
      "id, name, phone, credit_total_cents, paid_total_cents, balance_cents, credit_limit_cents, credit_available_cents, credit_limit_override_cents"
    )
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
//
// An optional range keeps only the sales the report counted for it: the same
// instants, half-open [from, to), on occurred_at (the column every report
// function filters on). Voided sales stay in the list; callers leave them out
// of totals, as report_summary does.
export async function fetchRecentSales(
  limit = 50,
  offset = 0,
  range?: { from: Date; to: Date } | null
): Promise<SaleSummary[]> {
  let query = supabase
    .from("sales")
    .select(
      "id, created_at, occurred_at, payment_method, total_cents, discount_cents, customer_id, cashier_id, voided_at, void_reason, customers(name), profiles!sales_cashier_id_fkey(full_name)"
    );
  if (range) {
    query = query
      .gte("occurred_at", range.from.toISOString())
      .lt("occurred_at", range.to.toISOString());
  }
  const { data, error } = await query
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

// --- item returns (migration 046) -----------------------------------------
// Owner only, online only: nothing is queued. The caller generates `returnId`
// once per attempt and reuses it on a retry, so a lost response can't refund
// twice (the database ignores a second call with the same id).
export async function recordSaleReturn(input: {
  returnId: string;
  saleId: string;
  items: { sale_item_id: string; quantity: number }[];
  reasonCode: ReturnReason;
  note: string;
  refundMethod: RefundMethod;
}): Promise<void> {
  const { error } = await supabase.rpc("record_sale_return", {
    p_return_id: input.returnId,
    p_sale_id: input.saleId,
    p_items: input.items,
    p_reason_code: input.reasonCode,
    p_note: input.note.trim() ? input.note.trim() : null,
    p_refund_method: input.refundMethod,
  });
  if (error) throw new Error(error.message);
}

// What can still be returned on each line of a sale, with what was paid for it
// (the server works out the sale-discount share; a device cannot).
export async function fetchReturnableLines(saleId: string): Promise<ReturnableLine[]> {
  const { data, error } = await supabase.rpc("returnable_sale_lines", { p_sale_id: saleId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    saleItemId: String(row.sale_item_id),
    quantity: Number(row.quantity),
    returnedQuantity: Number(row.returned_quantity),
    paidCents: Number(row.paid_cents),
    refundedCents: Number(row.refunded_cents),
  }));
}

// The returns of a batch of sales (one query per table for the whole page).
// Both roles read the cost-free item view: a cashier sees the returns of their
// own sales, the owner all of them; no cost column is ever selected.
export async function fetchSaleReturns(saleIds: string[]): Promise<SaleReturnRecord[]> {
  if (saleIds.length === 0) return [];
  const { data: headers, error } = await supabase
    .from("sale_returns")
    .select("id, sale_id, created_at, reason_code, note, refund_method, refund_cents")
    .in("sale_id", saleIds)
    .order("created_at");
  if (error) throw new Error(error.message);
  const rows = (headers ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const { data: items, error: itemsError } = await supabase
    .from("sale_return_items_cashier_view")
    .select("return_id, sale_item_id, quantity, refund_cents")
    .in("sale_id", saleIds);
  if (itemsError) throw new Error(itemsError.message);

  const byReturn = new Map<string, SaleReturnRecord["items"]>();
  for (const item of (items ?? []) as Record<string, unknown>[]) {
    const list = byReturn.get(String(item.return_id)) ?? [];
    list.push({
      saleItemId: String(item.sale_item_id),
      quantity: Number(item.quantity),
      refundCents: Number(item.refund_cents),
    });
    byReturn.set(String(item.return_id), list);
  }
  return rows.map((row) => ({
    id: String(row.id),
    saleId: String(row.sale_id),
    createdAt: String(row.created_at),
    reasonCode: row.reason_code as ReturnReason,
    note: (row.note as string | null) ?? null,
    refundMethod: row.refund_method as RefundMethod,
    refundCents: Number(row.refund_cents),
    items: byReturn.get(String(row.id)) ?? [],
  }));
}

export type CustomerPayment = {
  id: string;
  amount_cents: number;
  method: PaymentMethod;
  created_at: string;
};

// One customer's balance row (the same view the list reads, so the history
// header can never disagree with the list). Null when the customer is gone.
export async function fetchCustomerBalance(customerId: string): Promise<CustomerBalance | null> {
  const { data, error } = await supabase
    .from("customer_balances")
    .select(
      "id, name, phone, credit_total_cents, paid_total_cents, balance_cents, credit_limit_cents, credit_available_cents, credit_limit_override_cents"
    )
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CustomerBalance | null) ?? null;
}

// One credit sale as the customer history shows it. Deliberately thin: no cost,
// profit, discount or void reason, because every signed-in user gets these rows.
export type CustomerCreditSale = {
  id: string;
  occurred_at: string | null;
  created_at: string;
  total_cents: number;
  voided_at: string | null;
  // Who rang it up (null if the profile has no name).
  cashier_name: string | null;
  // True when the signed-in user rang this sale up: only then may a cashier
  // open its product lines (RLS hides the lines of other people's sales).
  is_own: boolean;
};

// One page of a customer's credit sales, newest first, voided ones included
// (the screen marks them and leaves them out of the totals). Both roles use the
// customer_credit_sales function: a cashier must see debt that another cashier
// or the owner rang up, which RLS on sales would hide. The function limits the
// page size itself (at most 100).
export async function fetchCustomerCreditSales(
  customerId: string,
  limit: number,
  offset: number
): Promise<CustomerCreditSale[]> {
  const { data, error } = await supabase.rpc("customer_credit_sales", {
    p_customer_id: customerId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as CustomerCreditSale[]).map((row) => ({
    ...row,
    total_cents: Number(row.total_cents),
  }));
}

// One credit return as the customer history shows it: refunded on the account,
// so it lowers the debt. No cost, lines or reason: every signed-in user gets
// these rows.
export type CustomerCreditReturn = {
  id: string;
  created_at: string;
  refund_cents: number;
  sale_id: string;
  item_count: number;
  occurred_at: string | null;
};

// One page of a customer's credit returns, newest first (customer_credit_returns,
// migration 046; at most 100 a page).
export async function fetchCustomerCreditReturns(
  customerId: string,
  limit: number,
  offset: number
): Promise<CustomerCreditReturn[]> {
  const { data, error } = await supabase.rpc("customer_credit_returns", {
    p_customer_id: customerId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as CustomerCreditReturn[]).map((row) => ({
    ...row,
    refund_cents: Number(row.refund_cents),
    item_count: Number(row.item_count),
  }));
}

// One page of a customer's repayments, newest first. Every signed-in user may
// read customer_payments (policy "staff read payments").
export async function fetchCustomerPayments(
  customerId: string,
  limit: number,
  offset: number
): Promise<CustomerPayment[]> {
  const { data, error } = await supabase
    .from("customer_payments")
    .select("id, amount_cents, method, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerPayment[];
}

// --- cashier discount limit (store_settings) ------------------------------
// Readable by every signed-in user (a cashier's device needs it to enforce the
// limit), updated by the owner only (row-level security).

export async function fetchDiscountLimits(): Promise<DiscountLimits> {
  const { data, error } = await supabase
    .from("store_settings")
    .select("cashier_discount_percent, cashier_discount_max_cents")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as {
    cashier_discount_percent: number | string | null;
    cashier_discount_max_cents: number | string | null;
  } | null;
  return (
    parseDiscountLimits(row?.cashier_discount_percent, row?.cashier_discount_max_cents) ??
    DEFAULT_DISCOUNT_LIMITS
  );
}

export async function updateDiscountLimits(limits: DiscountLimits): Promise<void> {
  const { error } = await supabase
    .from("store_settings")
    .update({
      cashier_discount_percent: limits.percent,
      cashier_discount_max_cents: limits.maxCents,
    })
    .eq("singleton", true);
  if (error) throw new Error(error.message);
  await saveCachedDiscountLimits(limits);
}

// --- customer debt limit (store_settings + customers) ------------------------
// The store default is readable by every signed-in user (a cashier's device
// needs it) and updated by the owner only (row-level security). A customer's
// own limit is changed by the owner only: a database trigger refuses anyone
// else, whatever the client sends.

export async function fetchStoreCreditLimit(): Promise<number> {
  const { data, error } = await supabase
    .from("store_settings")
    .select("customer_credit_limit_cents")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { customer_credit_limit_cents: number | string | null } | null;
  return parseCreditLimitCents(row?.customer_credit_limit_cents) ?? DEFAULT_CREDIT_LIMIT_CENTS;
}

export async function updateStoreCreditLimit(cents: number): Promise<void> {
  const { error } = await supabase
    .from("store_settings")
    .update({ customer_credit_limit_cents: cents })
    .eq("singleton", true);
  if (error) throw new Error(error.message);
  await saveCachedStoreCreditLimit(cents);
}

// null = back to the store default; 0 = no credit for this customer.
export async function updateCustomerCreditLimit(
  customerId: string,
  cents: number | null
): Promise<void> {
  const { error } = await supabase
    .from("customers")
    .update({ credit_limit_cents: cents })
    .eq("id", customerId);
  if (error) throw new Error(error.message);
}
