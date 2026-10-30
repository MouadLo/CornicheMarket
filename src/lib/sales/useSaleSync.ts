import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useState } from "react";

import {
  MAX_RETRY_ATTEMPTS,
  countPendingSales,
  countStuckSales,
  isAuthError,
  isTemporaryError,
  listPendingSales,
  markAttempt,
  quarantineSale,
  confirmPendingSale,
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

// Shared ownership is assigned synchronously, before any storage/network await.
// Network requests never hold the storage coordinator. Concurrent callers join
// this run and request a follow-up pass for sales enqueued during submission.
let activeSync: Promise<string | null> | null = null;
let passRequested = false;
export function syncPendingSales(): Promise<string | null> {
  if (activeSync) {
    passRequested = true;
    return activeSync;
  }
  activeSync = Promise.resolve()
    .then(async () => {
      let lastError: string | null = null;
      do {
        passRequested = false;
        const queue = await listPendingSales();
        for (const sale of queue) {
          try {
            await submitWithAuthRetry(sale);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Sync failed";
            lastError = message;
            if (!isTemporaryError(message) || sale.attempts + 1 >= MAX_RETRY_ATTEMPTS) {
              await quarantineSale(sale, message);
              continue;
            }
            await markAttempt(sale.id, message);
            return message;
          }
          // Storage failures must not be classified as backend rejections or
          // consume the retry budget. Leave the sale for an idempotent replay.
          await confirmPendingSale(sale.id);
        }
      } while (passRequested);
      return lastError;
    })
    .finally(() => {
      activeSync = null;
    });
  return activeSync;
}

export function useSaleSync() {
  const [state, setState] = useState<SyncState>({
    online: true,
    pending: 0,
    stuck: 0,
    syncing: false,
    lastError: null,
  });
  const reportError = useCallback((error: unknown) => {
    setState((current) => ({
      ...current,
      lastError: error instanceof Error ? error.message : "Sync failed",
    }));
  }, []);
  const refreshPending = useCallback(async () => {
    try {
      const [pending, stuck] = await Promise.all([countPendingSales(), countStuckSales()]);
      setState((current) => ({ ...current, pending, stuck }));
    } catch (error) {
      reportError(error);
    }
  }, [reportError]);
  const sync = useCallback(async () => {
    setState((current) => ({ ...current, syncing: true, lastError: null }));
    try {
      const lastError = await syncPendingSales();
      setState((current) => ({ ...current, lastError }));
      await refreshPending();
    } catch (error) {
      reportError(error);
    } finally {
      setState((current) => ({ ...current, syncing: false }));
    }
  }, [refreshPending, reportError]);
  useEffect(() => {
    void refreshPending();
    return NetInfo.addEventListener((netState) => {
      const online = Boolean(netState.isConnected && netState.isInternetReachable !== false);
      setState((current) => ({ ...current, online }));
      if (online) void sync();
    });
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
