import AsyncStorage from "@react-native-async-storage/async-storage";

import type { CartLine } from "@/src/lib/sales/totals";

const QUEUE_KEY = "corniche.pendingSales.v1";
const STUCK_KEY = "corniche.stuckSales.v1";

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
function isStuck(value: unknown): value is StuckSale {
  return (
    isRecord(value) &&
    isSale(value.sale) &&
    typeof value.error === "string" &&
    typeof value.failedAt === "string"
  );
}
async function readEntries<T>(key: string, valid: (value: unknown) => value is T): Promise<T[]> {
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
  if (!Array.isArray(parsed) || !parsed.every(valid)) {
    throw new Error(
      `Invalid sales storage: ${key}. Original data preserved; export raw sales storage for recovery.`
    );
  }
  return parsed;
}
const readQueue = () => readEntries(QUEUE_KEY, isSale);
const readStuck = () => readEntries(STUCK_KEY, isStuck);
const writeQueue = (sales: PendingSale[]) => AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(sales));
const writeStuck = (sales: StuckSale[]) => AsyncStorage.setItem(STUCK_KEY, JSON.stringify(sales));

// Recovery primitive: returns exact stored strings without parsing or changing
// them. A read failure propagates; callers must save/share this sensitive data
// deliberately. Never clear/repair an unreadable queue as a side effect.
export function exportRawSalesStorage(): Promise<{ pending: string | null; stuck: string | null }> {
  return withStorage(async () => ({
    pending: await AsyncStorage.getItem(QUEUE_KEY),
    stuck: await AsyncStorage.getItem(STUCK_KEY),
  }));
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
    if (!isSale(sale)) throw new Error("Invalid pending sale; nothing written");
    if (!queue.some((pending) => pending.id === sale.id)) await writeQueue([...queue, sale]);
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
