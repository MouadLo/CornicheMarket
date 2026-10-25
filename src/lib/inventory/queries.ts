import { productsSource, type Product } from "@/src/lib/products/queries";
import { supabase } from "@/src/lib/supabase/client";

export type AdjustmentReason = "damaged" | "expired" | "theft" | "count_correction";

export const ADJUSTMENT_REASONS: { value: AdjustmentReason; label: string }[] = [
  { value: "damaged", label: "Damaged" },
  { value: "expired", label: "Expired" },
  { value: "theft", label: "Theft" },
  { value: "count_correction", label: "Count correction" },
];

export type SalesVelocity = { product_id: string; quantity_sold: number; sale_count: number };

export type ExpiringBatch = {
  id: string;
  product_id: string;
  product_name: string;
  unit: string;
  stock_quantity: number;
  delivered_quantity: number;
  expiry_date: string;
  days_left: number;
};

export type AdjustmentRecord = {
  id: string;
  product_id: string;
  product_name: string;
  unit: string;
  quantity_delta: number;
  reason: AdjustmentReason;
  note: string | null;
  created_at: string;
  unit_cost_cents?: number | null;
};

export async function fetchLowStockProducts(isOwner: boolean): Promise<Product[]> {
  const columns = isOwner
    ? "id, name, barcode, category_id, unit, selling_price_cents, stock_quantity, low_stock_threshold, is_low_stock, active, current_cost_cents"
    : "id, name, barcode, category_id, unit, selling_price_cents, stock_quantity, low_stock_threshold, is_low_stock, active";

  const { data, error } = await supabase
    .from(productsSource(isOwner))
    .select(columns)
    .eq("is_low_stock", true)
    .eq("active", true)
    .order("name");

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ current_cost_cents: null, ...(row as object) })) as Product[];
}

export async function fetchSalesVelocity(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("product_sales_30d")
    .select("product_id, quantity_sold, sale_count")
    .in("product_id", productIds);

  if (error) throw new Error(error.message);

  const velocity = new Map<string, number>();
  ((data ?? []) as SalesVelocity[]).forEach((row) => {
    velocity.set(row.product_id, Number(row.quantity_sold));
  });
  return velocity;
}

export async function createAdjustment(
  productId: string,
  quantityDelta: number,
  reason: AdjustmentReason,
  note: string | null,
  userId: string
): Promise<void> {
  const { error } = await supabase.from("stock_adjustments").insert({
    product_id: productId,
    quantity_delta: quantityDelta,
    reason,
    note,
    created_by: userId,
  });
  if (error) throw new Error(error.message);
}

export async function fetchRecentAdjustments(isOwner: boolean): Promise<AdjustmentRecord[]> {
  if (isOwner) {
    const { data, error } = await supabase
      .from("stock_adjustments")
      .select("id, product_id, quantity_delta, reason, note, created_at, unit_cost_cents, products(name, unit)")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw new Error(error.message);

    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      product_id: row.product_id as string,
      product_name: (row.products as { name: string } | null)?.name ?? "Unknown",
      unit: (row.products as { unit: string } | null)?.unit ?? "piece",
      quantity_delta: Number(row.quantity_delta),
      reason: row.reason as AdjustmentReason,
      note: row.note as string | null,
      created_at: row.created_at as string,
      unit_cost_cents: row.unit_cost_cents as number | null,
    }));
  }

  const { data, error } = await supabase
    .from("stock_adjustments_cashier_view")
    .select("id, product_id, product_name, unit, quantity_delta, reason, note, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  return (data ?? []) as AdjustmentRecord[];
}

// The delta is the discrepancy the count found, measured against the figure
// the device was showing. Recording it as a relative adjustment means a sale
// made during the count is still subtracted, instead of being wiped out by
// an absolute "set stock to N".
export async function applyStockCount(
  productId: string,
  counted: number,
  systemQuantity: number,
  note: string,
  userId: string
): Promise<number> {
  const delta = Number((counted - systemQuantity).toFixed(3));
  if (delta === 0) return 0;

  await createAdjustment(productId, delta, "count_correction", note, userId);
  return delta;
}

export async function fetchExpiringBatches(withinDays: number): Promise<ExpiringBatch[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);

  const { data, error } = await supabase
    .from("expiring_batches")
    .select("id, product_id, product_name, unit, stock_quantity, delivered_quantity, expiry_date, days_left")
    .lte("expiry_date", cutoff.toISOString().slice(0, 10))
    .order("expiry_date");

  if (error) throw new Error(error.message);
  return (data ?? []) as ExpiringBatch[];
}
