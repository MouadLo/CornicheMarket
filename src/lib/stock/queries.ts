import { lineTotalCents } from "@/src/lib/money";
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
  // Set when the delivery was voided; it stays in the list, struck through.
  voided_at: string | null;
  void_reason: string | null;
  voided_by_name?: string | null;
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
  // A voided delivery's price must not pre-fill the next one: the typo that
  // was just cancelled is exactly what would come back as "last price paid".
  const { data, error } = await supabase
    .from("purchase_items")
    .select("unit_cost_cents, purchases!inner(voided_at)")
    .eq("product_id", productId)
    .is("purchases.voided_at", null)
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
    .select(
      "id, purchase_date, notes, supplier_id, supplier_name, total_cents, line_count, voided_at, void_reason, voided_by_name"
    )
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
    .select("id, created_at, quantity, unit_cost_cents, purchases!inner(voided_at)")
    .eq("product_id", productId)
    .is("purchases.voided_at", null)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw new Error(error.message);
  return (data ?? []) as PricePoint[];
}

export type PurchaseLine = {
  id: string;
  productName: string;
  unit: string;
  quantity: number;
  unitCostCents: number;
  lineTotalCents: number;
  expiryDate: string | null;
};

export type PurchaseDetail = {
  id: string;
  purchaseDate: string;
  notes: string | null;
  supplierName: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedByName: string | null;
  totalCents: number;
  lines: PurchaseLine[];
};

type PurchaseRow = {
  id: string;
  purchase_date: string;
  notes: string | null;
  voided_at: string | null;
  void_reason: string | null;
  suppliers: { name: string } | null;
  voider: { full_name: string | null } | null;
  purchase_items: {
    id: string;
    quantity: number | string;
    unit_cost_cents: number;
    expiry_date: string | null;
    created_at: string;
    products: { name: string; unit: string } | null;
  }[];
};

// One delivery with its lines, in the order they were received. Owner only
// (purchase_items carries cost; RLS refuses everyone else).
export async function fetchPurchase(id: string): Promise<PurchaseDetail> {
  const { data, error } = await supabase
    .from("purchases")
    .select(
      "id, purchase_date, notes, voided_at, void_reason, suppliers(name), voider:profiles!purchases_voided_by_fkey(full_name), purchase_items(id, quantity, unit_cost_cents, expiry_date, created_at, products(name, unit))"
    )
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  const row = data as unknown as PurchaseRow;

  const lines = [...row.purchase_items]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((item) => {
      const quantity = Number(item.quantity);
      return {
        id: item.id,
        productName: item.products?.name ?? "?",
        unit: item.products?.unit ?? "piece",
        quantity,
        unitCostCents: item.unit_cost_cents,
        lineTotalCents: lineTotalCents(quantity, item.unit_cost_cents),
        expiryDate: item.expiry_date,
      };
    });

  return {
    id: row.id,
    purchaseDate: row.purchase_date,
    notes: row.notes,
    supplierName: row.suppliers?.name ?? null,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    voidedByName: row.voider?.full_name ?? null,
    totalCents: lines.reduce((sum, line) => sum + line.lineTotalCents, 0),
    lines,
  };
}

export type VoidPreviewLine = {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  unitCostCents: number;
  stockBefore: number;
  stockAfter: number;
  costBeforeCents: number;
  costAfterCents: number;
};

// What voiding would do to each product, computed by the same SQL function
// that applies the void, so the confirmation can't promise otherwise.
export async function previewVoidPurchase(id: string): Promise<VoidPreviewLine[]> {
  const { data, error } = await supabase.rpc("preview_void_purchase", { p_purchase_id: id });
  if (error) throw new Error(error.message);

  return ((data ?? []) as Record<string, string | number>[]).map((row) => ({
    productId: String(row.product_id),
    productName: String(row.product_name),
    unit: String(row.unit),
    quantity: Number(row.quantity),
    unitCostCents: Number(row.unit_cost_cents),
    stockBefore: Number(row.stock_before),
    stockAfter: Number(row.stock_after),
    costBeforeCents: Number(row.cost_before_cents),
    costAfterCents: Number(row.cost_after_cents),
  }));
}

// Owner only, reason required. Past sales keep their stamped cost; stock and
// average cost are corrected by the database trigger, never here.
export async function voidPurchase(id: string, reason: string): Promise<void> {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A void needs a reason");

  const { error } = await supabase.rpc("void_purchase", {
    p_purchase_id: id,
    p_reason: trimmed,
  });
  if (error) throw new Error(error.message);
}
