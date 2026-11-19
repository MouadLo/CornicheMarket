import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

import { DEFAULT_DISCOUNT_LIMITS, type DiscountLimits } from "@/src/lib/sales/discountLimit";

// The cashier discount limit is enforced on the device, so a cashier who is
// offline needs the last limits the server gave. They are kept here, and the
// built-in defaults are used on a device that has never read them.
const KEY = "corniche.discountLimits.v1";

// A usable pair, or null (a missing, malformed or out-of-range value).
export function parseDiscountLimits(percent: unknown, maxCents: unknown): DiscountLimits | null {
  const p = typeof percent === "string" ? Number(percent) : percent;
  const m = typeof maxCents === "string" ? Number(maxCents) : maxCents;
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 100) return null;
  if (typeof m !== "number" || !Number.isSafeInteger(m) || m < 0) return null;
  return { percent: p, maxCents: m };
}

export async function loadCachedDiscountLimits(): Promise<DiscountLimits | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { percent?: unknown; maxCents?: unknown };
    return parseDiscountLimits(saved.percent, saved.maxCents);
  } catch {
    return null;
  }
}

export async function saveCachedDiscountLimits(limits: DiscountLimits): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(limits));
  } catch {
    /* The limits still apply this session; the next read tries again. */
  }
}

// The limits to enforce right now: the cached ones at once (works offline),
// then the server's whenever it can be reached. `enabled` is false for the
// owner, who has no limit and need not read anything.
export function useDiscountLimits(
  enabled: boolean,
  online: boolean,
  fetchLimits: () => Promise<DiscountLimits>
): DiscountLimits {
  const [limits, setLimits] = useState<DiscountLimits>(DEFAULT_DISCOUNT_LIMITS);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadCachedDiscountLimits().then((cached) => {
      if (!cancelled && cached) setLimits(cached);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !online) return;
    let cancelled = false;
    Promise.resolve()
      .then(fetchLimits)
      .then(async (value) => {
        const fresh = parseDiscountLimits(value?.percent, value?.maxCents);
        if (!fresh) return;
        await saveCachedDiscountLimits(fresh);
        if (!cancelled) setLimits(fresh);
      })
      .catch(() => {
        /* Offline or not deployed yet: keep the last known limits. */
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, online, fetchLimits]);

  return limits;
}
