import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

import { DEFAULT_CREDIT_LIMIT_CENTS } from "@/src/lib/sales/creditLimit";
import type { Customer } from "@/src/lib/sales/queries";

// The customer debt limit is enforced on the device, so a cashier who is
// offline needs the last store default and the last customers (with their
// balance and limit) the server gave. They are kept here; the built-in default
// is used on a device that has never read them.
const DEFAULT_KEY = "corniche.creditLimit.v1";
const CUSTOMERS_KEY = "corniche.creditCustomers.v1";

// A usable limit in centimes, or null (missing, malformed or negative).
export function parseCreditLimitCents(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

export async function loadCachedStoreCreditLimit(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(DEFAULT_KEY);
    return raw ? parseCreditLimitCents(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function saveCachedStoreCreditLimit(cents: number): Promise<void> {
  try {
    await AsyncStorage.setItem(DEFAULT_KEY, JSON.stringify(cents));
  } catch {
    /* The limit still applies this session; the next read tries again. */
  }
}

// Only what the counter needs. A malformed row is dropped, never trusted.
export function parseCachedCustomers(value: unknown): Customer[] {
  if (!Array.isArray(value)) return [];
  const customers: Customer[] = [];
  for (const row of value as Record<string, unknown>[]) {
    if (!row || typeof row.id !== "string" || typeof row.name !== "string") continue;
    const balance = typeof row.balance_cents === "number" ? row.balance_cents : undefined;
    const limit = parseCreditLimitCents(row.credit_limit_cents);
    customers.push({
      id: row.id,
      name: row.name,
      phone: typeof row.phone === "string" ? row.phone : null,
      ...(balance !== undefined && Number.isFinite(balance) ? { balance_cents: balance } : {}),
      ...(limit !== null ? { credit_limit_cents: limit } : {}),
    });
  }
  return customers;
}

export async function loadCachedCustomers(): Promise<Customer[]> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOMERS_KEY);
    return raw ? parseCachedCustomers(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export async function saveCachedCustomers(customers: Customer[]): Promise<void> {
  try {
    const slim = customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      balance_cents: c.balance_cents,
      credit_limit_cents: c.credit_limit_cents,
    }));
    await AsyncStorage.setItem(CUSTOMERS_KEY, JSON.stringify(slim));
  } catch {
    /* Offline falls back to whatever was saved before. */
  }
}

// The store default to enforce right now: the cached one at once (works
// offline), then the server's whenever it can be reached.
export function useStoreCreditLimit(online: boolean, fetchLimit: () => Promise<number>): number {
  const [limit, setLimit] = useState<number>(DEFAULT_CREDIT_LIMIT_CENTS);

  useEffect(() => {
    let cancelled = false;
    void loadCachedStoreCreditLimit().then((cached) => {
      if (!cancelled && cached !== null) setLimit(cached);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    Promise.resolve()
      .then(fetchLimit)
      .then(async (value) => {
        const fresh = parseCreditLimitCents(value);
        if (fresh === null) return;
        await saveCachedStoreCreditLimit(fresh);
        if (!cancelled) setLimit(fresh);
      })
      .catch(() => {
        /* Offline or not deployed yet: keep the last known default. */
      });
    return () => {
      cancelled = true;
    };
  }, [online, fetchLimit]);

  return limit;
}
