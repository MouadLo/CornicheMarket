// A cashier cannot void a sale; they ask, and the owner approves or refuses
// (migration 038). Every write goes through the two RPCs; nothing here updates
// the table directly. Until a request is approved the sale counts normally.
import { supabase } from "@/src/lib/supabase/client";

export const VOID_REASONS = [
  "wrong_item",
  "wrong_quantity",
  "customer_changed_mind",
  "other",
] as const;
export type VoidReason = (typeof VOID_REASONS)[number];

export type VoidRequestStatus = "pending" | "approved" | "refused";

export type MyVoidRequest = {
  id: string;
  saleId: string;
  status: VoidRequestStatus;
  reasonCode: VoidReason;
  note: string | null;
  refusalNote: string | null;
  requestedAt: string;
};

export type PendingVoidLine = { name: string; quantity: number; lineTotalCents: number };

export type PendingVoidRequest = {
  id: string;
  saleId: string;
  reasonCode: VoidReason;
  note: string | null;
  requestedAt: string;
  cashierName: string | null;
  totalCents: number;
  occurredAt: string;
  paymentMethod: "cash" | "card" | "credit";
  lines: PendingVoidLine[];
};

type T = (key: string, options?: Record<string, unknown>) => string;

// A "other" request must say why. Pure, so the form and the tests share it.
export function voidRequestValid(reason: VoidReason | null, note: string): boolean {
  if (!reason) return false;
  return reason !== "other" || note.trim().length > 0;
}

// Database message -> translation key, for the cases the person can act on.
export function voidRequestErrorKey(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("day is closed")) return "sell.voidErrDayClosed";
  if (m.includes("already pending")) return "sell.voidErrPending";
  if (m.includes("your own sales")) return "sell.voidErrNotYours";
  if (m.includes("already voided")) return "sell.voidErrAlreadyVoided";
  if (m.includes("has returns")) return "sell.voidErrHasReturns";
  if (m.includes("already been decided")) return "sell.voidErrDecided";
  if (m.includes("note is required")) return "sell.voidErrNoteRequired";
  return "sell.voidErrGeneric";
}

export function describeVoidRequestError(error: unknown, t: T): string {
  return t(voidRequestErrorKey(error instanceof Error ? error.message : ""));
}

export async function requestVoid(
  saleId: string,
  reasonCode: VoidReason,
  note?: string
): Promise<string> {
  const { data, error } = await supabase.rpc("request_void", {
    p_sale_id: saleId,
    p_reason_code: reasonCode,
    p_note: note?.trim() ? note.trim() : null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function decideVoidRequest(
  requestId: string,
  approve: boolean,
  note?: string
): Promise<void> {
  const { error } = await supabase.rpc("decide_void_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_note: note?.trim() ? note.trim() : null,
  });
  if (error) throw new Error(error.message);
}

// Newest first. RLS returns only the caller's own requests to a cashier.
export async function fetchMyVoidRequests(limit = 100): Promise<MyVoidRequest[]> {
  const { data, error } = await supabase
    .from("void_requests")
    .select("id, sale_id, status, reason_code, note, refusal_note, requested_at")
    .order("requested_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    saleId: String(r.sale_id),
    status: r.status as VoidRequestStatus,
    reasonCode: r.reason_code as VoidReason,
    note: (r.note as string | null) ?? null,
    refusalNote: (r.refusal_note as string | null) ?? null,
    requestedAt: String(r.requested_at),
  }));
}

// The status to show on a sale: its most recent request (list is newest first).
export function latestRequestBySale(requests: MyVoidRequest[]): Map<string, MyVoidRequest> {
  const out = new Map<string, MyVoidRequest>();
  for (const r of requests) if (!out.has(r.saleId)) out.set(r.saleId, r);
  return out;
}

type PendingRow = {
  id: string;
  sale_id: string;
  reason_code: VoidReason;
  note: string | null;
  requested_at: string;
  requested_by: string;
  sales: {
    total_cents: number;
    occurred_at: string;
    payment_method: "cash" | "card" | "credit";
    sale_items: {
      quantity: number;
      line_total_cents: number;
      products: { name: string } | null;
    }[];
  } | null;
};

// Owner: what is waiting for a decision, oldest first.
export async function fetchPendingVoidRequests(limit = 50): Promise<PendingVoidRequest[]> {
  const { data, error } = await supabase
    .from("void_requests")
    .select(
      "id, sale_id, reason_code, note, requested_at, requested_by, sales(total_cents, occurred_at, payment_method, sale_items(quantity, line_total_cents, products(name)))"
    )
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as PendingRow[];
  if (rows.length === 0) return [];

  const people = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", [...new Set(rows.map((r) => r.requested_by))]);
  const nameById = new Map<string, string>();
  for (const p of (people.data ?? []) as { id: string; full_name: string | null }[]) {
    if (p.full_name) nameById.set(p.id, p.full_name);
  }

  return rows.map((r) => ({
    id: r.id,
    saleId: r.sale_id,
    reasonCode: r.reason_code,
    note: r.note,
    requestedAt: r.requested_at,
    cashierName: nameById.get(r.requested_by) ?? null,
    totalCents: Number(r.sales?.total_cents ?? 0),
    occurredAt: r.sales?.occurred_at ?? r.requested_at,
    paymentMethod: r.sales?.payment_method ?? "cash",
    lines: (r.sales?.sale_items ?? []).map((i) => ({
      name: i.products?.name ?? "",
      quantity: Number(i.quantity),
      lineTotalCents: Number(i.line_total_cents),
    })),
  }));
}

const REASON_KEY: Record<VoidReason, string> = {
  wrong_item: "sell.voidReasonWrongItem",
  wrong_quantity: "sell.voidReasonWrongQuantity",
  customer_changed_mind: "sell.voidReasonChangedMind",
  other: "sell.voidReasonOther",
};
export function voidReasonKey(code: VoidReason): string {
  return REASON_KEY[code];
}
