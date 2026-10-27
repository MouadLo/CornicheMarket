import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  MAX_RETRY_ATTEMPTS,
  countPendingSales,
  countStuckSales,
  isAuthError,
  isTemporaryError,
  listPendingSales,
  markAttempt,
  quarantineSale,
  removePendingSale,
  type PendingSale,
} from "@/src/lib/sales/offlineQueue";
import { submitSale } from "@/src/lib/sales/queries";
import { supabase } from "@/src/lib/supabase/client";

// Submits a sale, and if it fails on an expired/invalid access token,
// refreshes the session once and retries the SAME sale immediately -- a
// stale token (the device was offline or backgrounded long enough that
// supabase-js's own background refresh timer never got to run) then clears
// within this single sync pass instead of surviving to backoff or
// quarantine. A second failure (including the refresh call itself failing,
// e.g. the refresh token has also expired) propagates to the caller, which
// classifies and handles it exactly as any other sync error.
export async function submitWithAuthRetry(sale: PendingSale): Promise<void> {
  try {
    await submitSale(sale);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    if (!isAuthError(message)) throw error;

    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) throw error;

    await submitSale(sale);
  }
}

export type SyncState = {
  online: boolean;
  pending: number;
  stuck: number;
  syncing: boolean;
  lastError: string | null;
};

export function useSaleSync() {
  const [state, setState] = useState<SyncState>({
    online: true,
    pending: 0,
    stuck: 0,
    syncing: false,
    lastError: null,
  });

  // Guards against two syncs overlapping (e.g. reconnect while a manual
  // sync is already running), which would retry the same sale twice.
  const syncing = useRef(false);

  const refreshPending = useCallback(async () => {
    const [pending, stuck] = await Promise.all([countPendingSales(), countStuckSales()]);
    setState((current) => ({ ...current, pending, stuck }));
  }, []);

  const sync = useCallback(async () => {
    if (syncing.current) return;

    const queue = await listPendingSales();
    if (queue.length === 0) {
      setState((current) => ({ ...current, pending: 0 }));
      return;
    }

    syncing.current = true;
    setState((current) => ({ ...current, syncing: true, lastError: null }));

    let lastError: string | null = null;

    for (const sale of queue) {
      try {
        await submitWithAuthRetry(sale);
        await removePendingSale(sale.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sync failed";
        lastError = message;

        const temporary = isTemporaryError(message);
        const exhausted = sale.attempts + 1 >= MAX_RETRY_ATTEMPTS;

        if (!temporary || exhausted) {
          // Permanent failure or retry budget spent → quarantine so the rest
          // of the queue is not blocked. Data is never deleted.
          await quarantineSale(sale, message);
        } else {
          // Transient network error → record the attempt and stop this run
          // to preserve the sale's position in the ordering.
          await markAttempt(sale.id, message);
          break;
        }
      }
    }

    syncing.current = false;
    const [pending, stuck] = await Promise.all([countPendingSales(), countStuckSales()]);
    setState((current) => ({ ...current, syncing: false, pending, stuck, lastError }));
  }, []);

  useEffect(() => {
    refreshPending();

    const unsubscribe = NetInfo.addEventListener((netState) => {
      const online = Boolean(netState.isConnected && netState.isInternetReachable !== false);
      setState((current) => ({ ...current, online }));
      if (online) sync();
    });

    return unsubscribe;
  }, [refreshPending, sync]);

  return { ...state, sync, refreshPending };
}

export function pendingSaleFrom(
  id: string,
  payment: {
    customer_id: string | null;
    payment_method: PendingSale["payment_method"];
    discount_cents: number;
    total_cents: number;
  },
  lines: PendingSale["lines"]
): PendingSale {
  return {
    id,
    ...payment,
    lines,
    created_at: new Date().toISOString(),
    attempts: 0,
  };
}
