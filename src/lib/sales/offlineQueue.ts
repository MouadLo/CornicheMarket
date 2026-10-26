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
};

export type StuckSale = {
  sale: PendingSale;
  error: string;
  failedAt: string;
};

// True for transient failures (network, server unavailable) that should be
// retried. False for permanent failures (validation, auth, bad data) that will
// never succeed and must be quarantined immediately.
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
    msg.includes("504")
  );
}

async function readQueue(): Promise<PendingSale[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingSale[]) : [];
  } catch {
    // A corrupt queue must not take the till down; worst case the cashier
    // re-enters unsynced sales, which is better than the app refusing to open.
    return [];
  }
}

async function writeQueue(sales: PendingSale[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(sales));
}

export async function listPendingSales(): Promise<PendingSale[]> {
  return readQueue();
}

export async function countPendingSales(): Promise<number> {
  return (await readQueue()).length;
}

export async function enqueueSale(sale: PendingSale): Promise<void> {
  const queue = await readQueue();
  if (queue.some((pending) => pending.id === sale.id)) return;
  await writeQueue([...queue, sale]);
}

export async function removePendingSale(id: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.filter((pending) => pending.id !== id));
}

export async function markAttempt(id: string, error: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(
    queue.map((pending) =>
      pending.id === id
        ? { ...pending, attempts: pending.attempts + 1, last_error: error }
        : pending
    )
  );
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

// ── Stuck (permanently-failed) sales ────────────────────────────────────────

async function readStuck(): Promise<StuckSale[]> {
  try {
    const raw = await AsyncStorage.getItem(STUCK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StuckSale[]) : [];
  } catch {
    return [];
  }
}

async function writeStuck(stuck: StuckSale[]): Promise<void> {
  await AsyncStorage.setItem(STUCK_KEY, JSON.stringify(stuck));
}

// Moves a sale out of the retry queue and into the stuck list. Safe to call
// more than once for the same id (idempotent).
export async function quarantineSale(sale: PendingSale, error: string): Promise<void> {
  const stuck = await readStuck();
  if (!stuck.some((s) => s.sale.id === sale.id)) {
    await writeStuck([...stuck, { sale, error, failedAt: new Date().toISOString() }]);
  }
  await removePendingSale(sale.id);
}

export async function listStuckSales(): Promise<StuckSale[]> {
  return readStuck();
}

export async function countStuckSales(): Promise<number> {
  return (await readStuck()).length;
}

// Moves a stuck sale back to the retry queue (resets attempt count).
export async function retryStuckSale(id: string): Promise<void> {
  const stuck = await readStuck();
  const entry = stuck.find((s) => s.sale.id === id);
  if (!entry) return;
  await enqueueSale({ ...entry.sale, attempts: 0, last_error: undefined });
  await writeStuck(stuck.filter((s) => s.sale.id !== id));
}

// Removes a stuck sale after the owner has exported / acknowledged it.
export async function dismissStuckSale(id: string): Promise<void> {
  const stuck = await readStuck();
  await writeStuck(stuck.filter((s) => s.sale.id !== id));
}
