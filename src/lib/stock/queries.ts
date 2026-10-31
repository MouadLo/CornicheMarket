import { supabase } from "@/src/lib/supabase/client";

export type Supplier = { id: string; name: string; phone: string | null };

export type PurchaseSummary = {
  id: string;
  purchase_date: string;
  notes: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  total_cents: number;
  line_count: number;
};

export type MonthlyTotal = {
  month: string;
  total_cents: number;
  purchase_count: number;
};

export type SupplierTotal = {
  supplier_id: string | null;
  supplier_name: string;
  total_cents: number;
  purchase_count: number;
};

export type PricePoint = {
  id: string;
  created_at: string;
  quantity: number;
  unit_cost_cents: number;
};

export type ReceiveLine = {
  product_id: string;
  quantity: number;
  unit_cost_cents: number;
  expiry_date: string | null;
};

export type PriceUpdate = { product_id: string; selling_price_cents: number };

export type DeliveryDraft = {
  supplierId: string | null;
  notes: string | null;
  lines: ReceiveLine[];
  priceUpdates: PriceUpdate[];
};

export class ReceiveDeliveryError extends Error {
  constructor(
    message: string,
    // already_saved: this operation id already recorded a delivery with
    // different details, so the first attempt landed even if the app never
    // heard back. Anything else the server refused is "rejected".
    public readonly kind: "already_saved" | "rejected"
  ) {
    super(message);
  }
}

export async function fetchSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase.from("suppliers").select("id, name, phone").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Supplier[];
}

export async function createSupplier(name: string, phone: string | null): Promise<Supplier> {
  const { data, error } = await supabase
    .from("suppliers")
    .insert({ name, phone })
    .select("id, name, phone")
    .single();
  if (error) throw new Error(error.message);
  return data as Supplier;
}

export async function fetchLastPurchasePrice(productId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("purchase_items")
    .select("unit_cost_cents")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? (data as { unit_cost_cents: number }).unit_cost_cents : null;
}

// One transaction for header, lines and selling-price changes. The caller
// generates operationId once per delivery and must send the same id on every
// retry until a purchase id comes back: that is what stops a retry from
// receiving the stock twice. Stock and weighted-average cost are never
// written here: the line inserts fire apply_purchase_item, which owns both.
export async function receiveDelivery(operationId: string, draft: DeliveryDraft): Promise<string> {
  const { data, error } = await supabase.rpc("receive_delivery", {
    p_operation_id: operationId,
    p_supplier_id: draft.supplierId,
    p_notes: draft.notes,
    p_lines: draft.lines,
    p_price_updates: draft.priceUpdates,
  });

  if (error) {
    throw new ReceiveDeliveryError(
      error.message,
      error.code === "CM409" ? "already_saved" : "rejected"
    );
  }
  return data as string;
}

export async function fetchPurchases(page: number, pageSize = 25): Promise<PurchaseSummary[]> {
  const from = page * pageSize;
  const { data, error } = await supabase
    .from("purchase_summaries")
    .select("id, purchase_date, notes, supplier_id, supplier_name, total_cents, line_count")
    .order("purchase_date", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) throw new Error(error.message);
  return (data ?? []) as PurchaseSummary[];
}

export async function fetchMonthlyTotals(): Promise<MonthlyTotal[]> {
  const { data, error } = await supabase
    .from("purchase_monthly_totals")
    .select("month, total_cents, purchase_count")
    .order("month", { ascending: false })
    .limit(12);

  if (error) throw new Error(error.message);
  return (data ?? []) as MonthlyTotal[];
}

export async function fetchSupplierTotals(): Promise<SupplierTotal[]> {
  const { data, error } = await supabase
    .from("purchase_supplier_totals")
    .select("supplier_id, supplier_name, total_cents, purchase_count")
    .order("total_cents", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as SupplierTotal[];
}

export async function fetchPriceHistory(productId: string): Promise<PricePoint[]> {
  const { data, error } = await supabase
    .from("purchase_items")
    .select("id, created_at, quantity, unit_cost_cents")
    .eq("product_id", productId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw new Error(error.message);
  return (data ?? []) as PricePoint[];
}
