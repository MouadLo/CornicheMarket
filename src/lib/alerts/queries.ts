// What the owner has to look at: sales flagged by migration 027 (an unusual
// price, a discount above the owner's threshold) and products with negative
// stock. All reads are owner-only in the database (RLS); a cashier gets zero
// rows, so the shell does not even ask.
import { supabase } from "@/src/lib/supabase/client";

export type ReviewKind = "price" | "discount";

const FLAG_COLUMN: Record<ReviewKind, "needs_price_review" | "needs_discount_review"> = {
  price: "needs_price_review",
  discount: "needs_discount_review",
};
// A flagged discount sale carries either log row (or both): a discount above
// the owner's threshold, or one above what a cashier may give.
const CASHIER_LIMIT_ACTION = "discount_over_cashier_limit";
const LOG_ACTIONS: Record<ReviewKind, string[]> = {
  price: ["price_mismatch"],
  discount: ["discount_over_threshold", CASHIER_LIMIT_ACTION],
};
const DISMISS_RPC: Record<ReviewKind, string> = {
  price: "dismiss_price_review",
  discount: "dismiss_discount_review",
};

export type AlertCounts = {
  price: number;
  discount: number;
  negativeStock: number;
  // Cashiers' requests to void a sale, waiting for the owner (migration 038).
  voidRequests: number;
};
export const NO_ALERTS: AlertCounts = { price: 0, discount: 0, negativeStock: 0, voidRequests: 0 };

export function totalAlerts(counts: AlertCounts, stuck: number): number {
  return counts.price + counts.discount + counts.negativeStock + counts.voidRequests + stuck;
}

async function countOf(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>
) {
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchAlertCounts(): Promise<AlertCounts> {
  const [price, discount, negativeStock, voidRequests] = await Promise.all([
    countOf(
      supabase
        .from("sales")
        .select("id", { count: "exact", head: true })
        .eq("needs_price_review", true)
    ),
    countOf(
      supabase
        .from("sales")
        .select("id", { count: "exact", head: true })
        .eq("needs_discount_review", true)
    ),
    countOf(
      supabase.from("negative_stock_products").select("product_id", { count: "exact", head: true })
    ),
    countOf(
      supabase
        .from("void_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
    ),
  ]);
  return { price, discount, negativeStock, voidRequests };
}

// --- review lists ----------------------------------------------------------

export type ReviewLine =
  | { type: "price"; name: string; deviceCents: number; expectedCents: number; stale: boolean }
  | { type: "discount"; name: string; amountCents: number; discountCents: number; percent: number }
  | { type: "saleDiscount"; amountCents: number; discountCents: number; percent: number }
  // A cashier gave more discount than the limit allows (which the device
  // enforces, so this is a device that was not up to date or was tampered with).
  | { type: "cashierLimit"; discountCents: number; limitCents: number };

export type ReviewItem = {
  saleId: string;
  occurredAt: string;
  totalCents: number;
  cashierName: string | null;
  lines: ReviewLine[];
};

type LogDetails = {
  lines?: Record<string, unknown>[];
  sale_discount?: { discount_cents: number; basket_cents: number; percent: number } | null;
  // discount_over_cashier_limit rows
  limit_cents?: number;
  total_discount_cents?: number;
};

// Turns one activity-log row into the lines the owner reads. Pure, so the two
// log shapes are tested without a database.
export function reviewLinesFrom(
  kind: ReviewKind,
  details: LogDetails | null | undefined,
  action?: string
): ReviewLine[] {
  if (!details) return [];
  if (action === CASHIER_LIMIT_ACTION) {
    return [
      {
        type: "cashierLimit",
        discountCents: Number(details.total_discount_cents),
        limitCents: Number(details.limit_cents),
      },
    ];
  }
  const lines: ReviewLine[] = [];
  for (const line of details.lines ?? []) {
    const name = String(line.product_name ?? "");
    if (kind === "price") {
      lines.push({
        type: "price",
        name,
        deviceCents: Number(line.device_price_cents),
        expectedCents: Number(line.expected_price_cents),
        stale: line.matches_previous_price === true,
      });
    } else {
      lines.push({
        type: "discount",
        name,
        amountCents: Number(line.line_amount_cents),
        discountCents: Number(line.discount_cents),
        percent: Number(line.percent),
      });
    }
  }
  if (kind === "discount" && details.sale_discount) {
    lines.push({
      type: "saleDiscount",
      amountCents: Number(details.sale_discount.basket_cents),
      discountCents: Number(details.sale_discount.discount_cents),
      percent: Number(details.sale_discount.percent),
    });
  }
  return lines;
}

export async function fetchReviewSales(kind: ReviewKind, limit = 50): Promise<ReviewItem[]> {
  const { data: sales, error } = await supabase
    .from("sales")
    .select("id, occurred_at, total_cents, cashier_id")
    .eq(FLAG_COLUMN[kind], true)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (sales ?? []) as {
    id: string;
    occurred_at: string;
    total_cents: number;
    cashier_id: string;
  }[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [logs, people] = await Promise.all([
    (() => {
      const actions = LOG_ACTIONS[kind];
      const query = supabase.from("activity_log").select("entity_id, action, details");
      return (
        actions.length === 1 ? query.eq("action", actions[0]) : query.in("action", actions)
      ).in("entity_id", ids);
    })(),
    supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", [...new Set(rows.map((r) => r.cashier_id))]),
  ]);
  if (logs.error) throw new Error(logs.error.message);

  const linesBySale = new Map<string, ReviewLine[]>();
  for (const row of (logs.data ?? []) as {
    entity_id: string;
    action?: string;
    details: LogDetails;
  }[]) {
    const found = reviewLinesFrom(kind, row.details, row.action);
    linesBySale.set(row.entity_id, [...(linesBySale.get(row.entity_id) ?? []), ...found]);
  }
  const nameById = new Map<string, string>();
  for (const p of (people.data ?? []) as { id: string; full_name: string | null }[]) {
    if (p.full_name) nameById.set(p.id, p.full_name);
  }

  return rows.map((r) => ({
    saleId: r.id,
    occurredAt: r.occurred_at,
    totalCents: Number(r.total_cents),
    cashierName: nameById.get(r.cashier_id) ?? null,
    lines: linesBySale.get(r.id) ?? [],
  }));
}

export async function dismissReview(kind: ReviewKind, saleId: string): Promise<void> {
  const { error } = await supabase.rpc(DISMISS_RPC[kind], { p_sale_id: saleId });
  if (error) throw new Error(error.message);
}
