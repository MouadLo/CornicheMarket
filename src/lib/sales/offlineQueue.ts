import AsyncStorage from "@react-native-async-storage/async-storage";

import type { CartLine } from "@/src/lib/sales/totals";

const QUEUE_KEY = "corniche.pendingSales.v1";
const STUCK_KEY = "corniche.stuckSales.v1";
// Entries that could not be understood, kept exactly as they were found.
const UNREADABLE_KEY = "corniche.unreadableSales.v1";

export const MAX_RETRY_ATTEMPTS = 5;

export type PendingSale = {
  // Generated on the device before the sale is sent. This is the sale's real
  // primary key, which is what makes re-sending it safe.
  id: string;
  customer_id: string | null;
  payment_method: "cash" | "card" | "credit";
  discount_cents: number;
  total_cents: number;
  lines: CartLine[];
  created_at: string;
  attempts: number;
  last_error?: string;
  // The user who rang this sale up, captured when it was accepted. Only that
  // user's own session may send it (the server credits the session, never a
  // claim in the payload). Missing on sales queued before audit C05 was fixed:
  // those are "legacy" and are never sent automatically.
  cashier_id?: string;
};

// A stored entry no version of the app can read as a sale. Never deleted: it is
// listed for the owner and included in the raw recovery export.
export type UnreadableSale = {
  source: "pending" | "stuck";
  raw: unknown;
  movedAt: string;
};

export type StuckSale = {
  sale: PendingSale;
  error: string;
  failedAt: string;
};

// An expired or invalid access token, as distinct from a genuine permission
// denial (RLS rejecting an action the user is not allowed to take, which
// stays permanent). This gets its own check because the real fix is not
// just "retry" but "refresh the session first" -- retrying with the same
// stale token would only fail again the same way. See submitWithAuthRetry
// in useSaleSync.ts.
export function isAuthError(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("jwt") ||
    msg.includes("refresh token") ||
    msg.includes("401") ||
    msg.includes("unauthorized")
  );
}

// True for transient failures (network, server unavailable, expired auth
// token) that should be retried. False for permanent failures (validation,
// RLS denial, missing product) that will never succeed and must be
// quarantined immediately.
//
// An expired token after a long offline/background period is temporary:
// it resolves the moment the session refreshes, which is exactly what
// happens before a sale reaches isTemporaryError at all now (see
// submitWithAuthRetry) -- but it is classified temporary here too, so a
// sale whose refresh attempt itself fails (e.g. the refresh token has also
// expired) still gets ordinary retry/backoff instead of being quarantined
// on the very first attempt.
export function isTemporaryError(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("failed to fetch") ||
    msg.includes("fetch failed") ||
    msg.includes("socket") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    isAuthError(message)
  );
}

// One coordinator per JS runtime (not a cross-tab/process lock). Reads also
// participate so callers never observe half of a pending <-> stuck transfer.
let storageTail: Promise<unknown> = Promise.resolve();
function withStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageTail.then(operation);
  storageTail = result.catch(() => undefined);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isSale(value: unknown): value is PendingSale {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    (value.customer_id === null || typeof value.customer_id === "string") &&
    typeof value.payment_method === "string" &&
    ["cash", "card", "credit"].includes(value.payment_method) &&
    Number.isSafeInteger(value.discount_cents) &&
    Number.isSafeInteger(value.total_cents) &&
    Number.isSafeInteger(value.attempts) &&
    typeof value.created_at === "string" &&
    (value.last_error === undefined || typeof value.last_error === "string") &&
    (value.cashier_id === undefined ||
      (typeof value.cashier_id === "string" && value.cashier_id.length > 0)) &&
    Array.isArray(value.lines) &&
    value.lines.every(
      (line: unknown) =>
        isRecord(line) &&
        typeof line.product_id === "string" &&
        typeof line.name === "string" &&
        typeof line.unit === "string" &&
        typeof line.quantity === "number" &&
        Number.isFinite(line.quantity) &&
        Number.isSafeInteger(line.unit_price_cents) &&
        Number.isSafeInteger(line.discount_cents) &&
        (line.unit_cost_cents === null || Number.isSafeInteger(line.unit_cost_cents))
    )
  );
}
// Upgrades a sale written by an older build to the current shape. Only fields
// whose absence unambiguously meant "none" are filled in (a line's cost,
// discounts, the customer, the attempt count); anything else that is wrong
// returns null and the entry is set aside instead. Never throws.
//   unit_cost_cents: older builds stored products from the offline cache, which
//   carry no cost, and JSON drops `undefined`, so the key is simply missing.
export function normalizeSale(value: unknown): PendingSale | null {
  if (!isRecord(value)) return null;
  const sale: Record<string, unknown> = { ...value };
  if (sale.customer_id === undefined) sale.customer_id = null;
  if (sale.discount_cents === undefined) sale.discount_cents = 0;
  if (sale.attempts === undefined) sale.attempts = 0;
  if (sale.last_error === null) delete sale.last_error;
  if (Array.isArray(sale.lines)) {
    sale.lines = sale.lines.map((line: unknown) => {
      if (!isRecord(line)) return line;
      const next: Record<string, unknown> = { ...line };
      if (next.unit_cost_cents === undefined) next.unit_cost_cents = null;
      if (next.discount_cents === undefined) next.discount_cents = 0;
      return next;
    });
  }
  return isSale(sale) ? sale : null;
}
function normalizeStuck(value: unknown): StuckSale | null {
  if (!isRecord(value)) return null;
  const sale = normalizeSale(value.sale);
  if (!sale || typeof value.error !== "string" || typeof value.failedAt !== "string") return null;
  return { sale, error: value.error, failedAt: value.failedAt };
}

// Reads a list of entries. Storage that is not a JSON array is unreadable as a
// whole and throws, untouched (C02). Within a readable array, old shapes are
// migrated in memory and entries that cannot be read are copied, byte for byte,
// to the unreadable list BEFORE they are dropped from this one: if that copy
// cannot be written, the read fails and nothing has changed. They never block
// the entries that are fine.
async function readEntries<T>(
  key: string,
  source: UnreadableSale["source"],
  normalize: (value: unknown) => T | null
): Promise<T[]> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Unreadable sales storage: ${key}. Original data preserved; export raw sales storage for recovery.`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Invalid sales storage: ${key}. Original data preserved; export raw sales storage for recovery.`
    );
  }
  const good: T[] = [];
  const aside: unknown[] = [];
  for (const entry of parsed) {
    const normalized = normalize(entry);
    if (normalized === null) aside.push(entry);
    else good.push(normalized);
  }
  if (aside.length === 0) return good;

  const kept = await readUnreadable();
  const known = new Set(kept.map((entry) => `${entry.source}:${JSON.stringify(entry.raw)}`));
  const movedAt = new Date().toISOString();
  const added = aside
    .filter((entry) => !known.has(`${source}:${JSON.stringify(entry)}`))
    .map((entry): UnreadableSale => ({ source, raw: entry, movedAt }));
  if (added.length > 0) {
    await AsyncStorage.setItem(UNREADABLE_KEY, JSON.stringify([...kept, ...added]));
  }
  // The copy is safe: shrink this list. If this write fails the entries simply
  // stay where they are and are found (and de-duplicated) on the next read.
  try {
    await AsyncStorage.setItem(
      key,
      JSON.stringify(parsed.filter((entry) => !aside.includes(entry)))
    );
  } catch {
    /* harmless: see above */
  }
  return good;
}
async function readUnreadable(): Promise<UnreadableSale[]> {
  const raw = await AsyncStorage.getItem(UNREADABLE_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Unreadable sales storage: ${UNREADABLE_KEY}. Original data preserved; export raw sales storage for recovery.`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Invalid sales storage: ${UNREADABLE_KEY}. Original data preserved; export raw sales storage for recovery.`
    );
  }
  return parsed as UnreadableSale[];
}
const readQueue = () => readEntries(QUEUE_KEY, "pending", normalizeSale);
const readStuck = () => readEntries(STUCK_KEY, "stuck", normalizeStuck);
const writeQueue = (sales: PendingSale[]) => AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(sales));
const writeStuck = (sales: StuckSale[]) => AsyncStorage.setItem(STUCK_KEY, JSON.stringify(sales));

// Recovery primitive: returns exact stored strings without parsing or changing
// them. A read failure propagates; callers must save/share this sensitive data
// deliberately. Never clear/repair an unreadable queue as a side effect.
export function exportRawSalesStorage(): Promise<{
  pending: string | null;
  stuck: string | null;
  unreadable: string | null;
}> {
  return withStorage(async () => ({
    pending: await AsyncStorage.getItem(QUEUE_KEY),
    stuck: await AsyncStorage.getItem(STUCK_KEY),
    unreadable: await AsyncStorage.getItem(UNREADABLE_KEY),
  }));
}
// Entries no version of the app could read, set aside intact (see readEntries).
export function listUnreadableSales(): Promise<UnreadableSale[]> {
  return withStorage(async () => {
    // Reading the lists is what finds and sets aside any such entries.
    await readQueue();
    await readStuck();
    return readUnreadable();
  });
}
export async function countUnreadableSales(): Promise<number> {
  return (await listUnreadableSales()).length;
}
export function listPendingSales(): Promise<PendingSale[]> {
  return withStorage(readQueue);
}
export function countPendingSales(): Promise<number> {
  return withStorage(async () => (await readQueue()).length);
}

// --- ownership (audit C05) --------------------------------------------------

// Splits a queue by who may send each sale. Nobody signed in owns nothing.
export function partitionByOwner(
  queue: PendingSale[],
  userId: string | null
): { mine: PendingSale[]; others: PendingSale[]; legacy: PendingSale[] } {
  const mine: PendingSale[] = [];
  const others: PendingSale[] = [];
  const legacy: PendingSale[] = [];
  for (const sale of queue) {
    if (sale.cashier_id === undefined) legacy.push(sale);
    else if (userId !== null && sale.cashier_id === userId) mine.push(sale);
    else others.push(sale);
  }
  return { mine, others, legacy };
}
// Sales this user may send.
export function countPendingFor(userId: string | null): Promise<number> {
  return withStorage(async () => partitionByOwner(await readQueue(), userId).mine.length);
}
// Everything on this device that this user may NOT send: other users' sales and
// legacy sales. These wait for their own user, or for the owner to recover them.
export function listSalesOfOthers(userId: string | null): Promise<PendingSale[]> {
  return withStorage(async () => {
    const { others, legacy } = partitionByOwner(await readQueue(), userId);
    const keep = new Set([...others, ...legacy].map((sale) => sale.id));
    return (await readQueue()).filter((sale) => keep.has(sale.id));
  });
}
export function enqueueSale(sale: PendingSale): Promise<void> {
  return withStorage(async () => {
    const queue = await readQueue();
    // A line picked from the offline cache has no cost field: store it as null.
    const accepted = normalizeSale(sale);
    if (!accepted) throw new Error("Invalid pending sale; nothing written");
    if (!queue.some((pending) => pending.id === accepted.id)) {
      await writeQueue([...queue, accepted]);
    }
  });
}
export function removePendingSale(id: string): Promise<void> {
  return withStorage(async () => {
    const queue = await readQueue();
    await writeQueue(queue.filter((pending) => pending.id !== id));
  });
}
// After backend acknowledgement, remove the stuck copy first. If either
// write fails, the pending copy remains and the same UUID is safe to replay.
export function confirmPendingSale(id: string): Promise<void> {
  return withStorage(async () => {
    const queue = await readQueue();
    const stuck = await readStuck();
    if (stuck.some((entry) => entry.sale.id === id)) {
      await writeStuck(stuck.filter((entry) => entry.sale.id !== id));
    }
    await writeQueue(queue.filter((sale) => sale.id !== id));
  });
}
export function markAttempt(id: string, error: string): Promise<void> {
  return withStorage(async () => {
    const queue = await readQueue();
    await writeQueue(
      queue.map((pending) =>
        pending.id === id
          ? { ...pending, attempts: pending.attempts + 1, last_error: error }
          : pending
      )
    );
  });
}
export function clearQueue(): Promise<void> {
  return withStorage(async () => {
    await readQueue(); // Explicit clear must not destroy unreadable financial data.
    await AsyncStorage.removeItem(QUEUE_KEY);
  });
}
export function quarantineSale(sale: PendingSale, error: string): Promise<void> {
  return withStorage(async () => {
    const queue = await readQueue();
    const stuck = await readStuck();
    if (!isSale(sale)) throw new Error("Invalid pending sale; nothing written");
    // Destination first: a crash/failed second write leaves a recoverable copy
    // in both lists, never neither. Backend UUID idempotency handles replays.
    if (!stuck.some((entry) => entry.sale.id === sale.id)) {
      await writeStuck([...stuck, { sale, error, failedAt: new Date().toISOString() }]);
    }
    await writeQueue(queue.filter((pending) => pending.id !== sale.id));
  });
}
export function listStuckSales(): Promise<StuckSale[]> {
  return withStorage(readStuck);
}
export function countStuckSales(): Promise<number> {
  return withStorage(async () => (await readStuck()).length);
}
export function retryStuckSale(id: string): Promise<void> {
  return withStorage(async () => {
    const stuck = await readStuck();
    const queue = await readQueue();
    const entry = stuck.find((value) => value.sale.id === id);
    if (!entry) return;
    if (queue.some((sale) => sale.id === id)) {
      await writeStuck(stuck.filter((value) => value.sale.id !== id));
      return;
    }
    const retry = { ...entry.sale, attempts: 0, last_error: undefined };
    await writeQueue([...queue.filter((sale) => sale.id !== id), retry]);
    await writeStuck(stuck.filter((value) => value.sale.id !== id));
  });
}
// Explicit owner acknowledgement retains its existing meaning.
export function dismissStuckSale(id: string): Promise<void> {
  return withStorage(async () => {
    const stuck = await readStuck();
    await writeStuck(stuck.filter((entry) => entry.sale.id !== id));
  });
}
