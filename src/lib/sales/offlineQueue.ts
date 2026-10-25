import AsyncStorage from "@react-native-async-storage/async-storage";

import type { CartLine } from "@/src/lib/sales/totals";

const QUEUE_KEY = "corniche.pendingSales.v1";

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
