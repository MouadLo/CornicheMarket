import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { CartLine } from "@/src/lib/sales/totals";

// The basket lives above the Sell screen so it survives opening another
// section mid-sale (UX C3), and is saved on the device so a reload keeps it.
// It belongs to one signed-in user: another user never sees it.

export type Basket = { lines: CartLine[]; saleDiscount: string };

// Prices in a basket are a snapshot; an old one is not worth bringing back.
export const BASKET_MAX_AGE_MS = 8 * 60 * 60 * 1000;

const EMPTY: Basket = { lines: [], saleDiscount: "" };

export function basketKey(userId: string): string {
  return `corniche.basket.${userId}`;
}

function isLine(value: unknown): value is CartLine {
  const line = value as Partial<CartLine> | null;
  return (
    typeof line === "object" &&
    line !== null &&
    typeof line.product_id === "string" &&
    typeof line.name === "string" &&
    typeof line.unit === "string" &&
    typeof line.quantity === "number" &&
    Number.isFinite(line.quantity) &&
    Number.isInteger(line.unit_price_cents) &&
    Number.isInteger(line.discount_cents) &&
    (line.unit_cost_cents === null || Number.isInteger(line.unit_cost_cents)) &&
    (line.discountable === undefined || typeof line.discountable === "boolean")
  );
}

// What a saved basket restores to: nothing when it is unreadable, stale or empty.
export function restoreBasket(raw: string | null, now: number): Basket | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as { savedAt?: unknown; lines?: unknown; saleDiscount?: unknown };
    if (typeof saved.savedAt !== "number" || now - saved.savedAt > BASKET_MAX_AGE_MS) return null;
    if (!Array.isArray(saved.lines) || !saved.lines.every(isLine)) return null;
    if (saved.lines.length === 0) return null;
    return {
      // A basket saved before the discount limit has no flag: it is allowed.
      lines: saved.lines.map((line) => ({ ...line, discountable: line.discountable ?? true })),
      saleDiscount: typeof saved.saleDiscount === "string" ? saved.saleDiscount : "",
    };
  } catch {
    return null;
  }
}

let owner: string | null = null;
let basket: Basket = EMPTY;
const listeners = new Set<() => void>();
const writtenKeys = new Set<string>();

function emit() {
  for (const listener of listeners) listener();
}

function save(userId: string, next: Basket) {
  const key = basketKey(userId);
  writtenKeys.add(key);
  const write =
    next.lines.length === 0
      ? AsyncStorage.removeItem(key)
      : AsyncStorage.setItem(key, JSON.stringify({ ...next, savedAt: Date.now() }));
  // Saving is a convenience: the basket in memory is the one that counts.
  void write.catch(() => {});
}

function useOwner(userId: string | null) {
  useEffect(() => {
    if (!userId || owner === userId) return;
    owner = userId;
    basket = EMPTY;
    emit();
    void AsyncStorage.getItem(basketKey(userId))
      .then((raw) => {
        const restored = restoreBasket(raw, Date.now());
        // Only if nothing was added meanwhile and the user did not change.
        if (restored && owner === userId && basket.lines.length === 0) {
          basket = restored;
          emit();
        }
      })
      .catch(() => {});
  }, [userId]);
}

type Update<T> = T | ((current: T) => T);

export function useBasket(userId: string | null) {
  useOwner(userId);
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  const current = useSyncExternalStore(
    subscribe,
    () => basket,
    () => basket
  );
  const visible = owner === userId ? current : EMPTY;

  const update = useCallback(
    (change: (previous: Basket) => Basket) => {
      if (!userId || owner !== userId) return;
      basket = change(basket);
      save(userId, basket);
      emit();
    },
    [userId]
  );

  const setLines = useCallback(
    (next: Update<CartLine[]>) =>
      update((previous) => ({
        ...previous,
        lines: typeof next === "function" ? next(previous.lines) : next,
      })),
    [update]
  );
  const setSaleDiscount = useCallback(
    (next: Update<string>) =>
      update((previous) => ({
        ...previous,
        saleDiscount: typeof next === "function" ? next(previous.saleDiscount) : next,
      })),
    [update]
  );

  return { lines: visible.lines, saleDiscount: visible.saleDiscount, setLines, setSaleDiscount };
}

export async function __resetBasketForTests() {
  owner = null;
  basket = EMPTY;
  listeners.clear();
  const keys = [...writtenKeys];
  writtenKeys.clear();
  await Promise.all(keys.map((key) => AsyncStorage.removeItem(key)?.catch?.(() => {})));
}
