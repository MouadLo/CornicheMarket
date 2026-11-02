import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/src/lib/auth/AuthProvider";
import {
  countPendingFor,
  countStuckSales,
  countUnreadableSales,
  listSalesOfOthers,
  partitionByOwner,
  isAuthError,
  isTemporaryError,
  listPendingSales,
  quarantineSale,
  confirmPendingSale,
  type PendingSale,
} from "@/src/lib/sales/offlineQueue";
import { probeReachable, retryDelay, subscribeToForeground } from "@/src/lib/sales/connectivity";
import { submitSale } from "@/src/lib/sales/queries";
import { supabase } from "@/src/lib/supabase/client";

// A sale may only be sent by the session of the user who rang it up. The
// server credits whoever's session sends it (and never a claim in the payload),
// so this is the guard that stops A's sale being recorded under B (audit C05).
export const WRONG_SESSION_MESSAGE = "This sale was rung up by another user";
export class WrongSessionError extends Error {
  constructor() {
    super(WRONG_SESSION_MESSAGE);
    this.name = "WrongSessionError";
  }
}
// Also matches the server's own refusal (record_sale's expected-cashier guard).
export function isWrongSessionError(message: string): boolean {
  return message.toLowerCase().includes("rung up by another user");
}

async function assertSessionOwns(sale: PendingSale): Promise<void> {
  // Legacy sales (no user id) are never sent automatically: nobody can say whose they are.
  if (!sale.cashier_id) throw new WrongSessionError();
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id !== sale.cashier_id) throw new WrongSessionError();
}

// Submits a sale, and if it fails on an expired/invalid access token,
// refreshes the session once and retries the SAME sale immediately -- a
// stale token (the device was offline or backgrounded long enough that
// supabase-js's own background refresh timer never got to run) then clears
// within this single sync pass instead of surviving to backoff or
// quarantine. A second failure (including the refresh call itself failing,
// e.g. the refresh token has also expired) propagates to the caller, which
// classifies and handles it exactly as any other sync error.
//
// The owner check runs before the first attempt AND again after the refresh:
// the refresh can land on a different account if someone signed in meanwhile.
export async function submitWithAuthRetry(sale: PendingSale): Promise<void> {
  await assertSessionOwns(sale);
  try {
    await submitSale(sale);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    if (!isAuthError(message)) throw error;

    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) throw error;

    await assertSessionOwns(sale);
    await submitSale(sale);
  }
}

export type SyncState = {
  online: boolean;
  // Sales this user may send.
  pending: number;
  // Sales on this device left by other users (or legacy ones): they wait for
  // their own user, or for the owner to recover them.
  others: number;
  stuck: number;
  syncing: boolean;
  lastError: string | null;
};

// Shared ownership is assigned synchronously, before any storage/network await.
// Network requests never hold the storage coordinator. Concurrent callers for the
// SAME user join this run and request a follow-up pass for sales enqueued during
// submission. A caller for a DIFFERENT user waits for it, then runs its own: it
// must never join a run that sends someone else's sales, nor have the follow-up
// pass read the queue for the wrong user.
let activeSync: { userId: string | null; promise: Promise<string | null> } | null = null;
let passRequested = false;
export function syncPendingSales(userId: string | null): Promise<string | null> {
  if (activeSync) {
    if (activeSync.userId === userId) {
      passRequested = true;
      return activeSync.promise;
    }
    return activeSync.promise.catch(() => null).then(() => syncPendingSales(userId));
  }
  const promise = Promise.resolve()
    .then(async () => {
      let lastError: string | null = null;
      do {
        passRequested = false;
        // Only this user's sales. Everyone else's stay exactly as they are.
        const queue = partitionByOwner(await listPendingSales(), userId).mine;
        for (const sale of queue) {
          try {
            await submitWithAuthRetry(sale);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Sync failed";
            lastError = message;
            // Not a failure of the sale: the session is not its user's. Leave it
            // queued, uncounted and unquarantined, for the right session.
            if (isWrongSessionError(message)) continue;
            if (isTemporaryError(message)) return message;
            await quarantineSale(sale, message);
            continue;
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
  activeSync = { userId, promise };
  return promise;
}

export function useSaleSync() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [state, setState] = useState<SyncState>({
    online: true,
    pending: 0,
    others: 0,
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
      const [pending, others, stuck] = await Promise.all([
        countPendingFor(userId),
        // Entries no version can read count with the sales waiting on someone else.
        Promise.all([listSalesOfOthers(userId), countUnreadableSales()]).then(
          ([sales, unreadable]) => sales.length + unreadable
        ),
        countStuckSales(),
      ]);
      setState((current) => ({ ...current, pending, others, stuck }));
    } catch (error) {
      reportError(error);
    }
  }, [reportError, userId]);
  // Asks the backend itself; NetInfo's flag is a hint, never the answer.
  const checkReachable = useCallback(async () => {
    const online = await probeReachable();
    setState((current) => ({ ...current, online }));
    return online;
  }, []);
  const runSync = useCallback(async () => {
    try {
      const lastError = await syncPendingSales(userId);
      setState((current) => ({ ...current, lastError }));
      await refreshPending();
    } catch (error) {
      reportError(error);
    }
  }, [refreshPending, reportError, userId]);
  // The manual button. It never trusts the "offline" label: it looks first, and
  // if the server answers it sends. If it truly cannot be reached, no sale is
  // touched (a failed send would need another retry).
  const sync = useCallback(async () => {
    setState((current) => ({ ...current, syncing: true, lastError: null }));
    try {
      if (await checkReachable()) await runSync();
    } finally {
      setState((current) => ({ ...current, syncing: false }));
    }
  }, [checkReachable, runSync]);
  // The background check: quiet unless there is something to send.
  const attempt = useRef(0);
  const tick = useCallback(async () => {
    if (!(await checkReachable())) return;
    if ((await countPendingFor(userId)) === 0) return void (await refreshPending());
    setState((current) => ({ ...current, syncing: true }));
    try {
      await runSync();
    } finally {
      setState((current) => ({ ...current, syncing: false }));
    }
  }, [checkReachable, refreshPending, runSync, userId]);
  const recheck = useCallback(() => {
    attempt.current = 0;
    void tick();
  }, [tick]);

  useEffect(() => {
    void refreshPending();
    const stopNetInfo = NetInfo.addEventListener((netState) => {
      // "No connection" is trusted at once; anything else is checked for real.
      if (netState.isConnected === false) setState((current) => ({ ...current, online: false }));
      else recheck();
    });
    const stopForeground = subscribeToForeground(recheck);
    return () => {
      stopNetInfo();
      stopForeground();
    };
  }, [refreshPending, recheck]);

  // Events can be missed (the web does not always send them), so while the app
  // believes it is offline or sales are waiting, look again on a backoff.
  const needsRetry = !state.online || state.pending > 0;
  useEffect(() => {
    if (!needsRetry) {
      attempt.current = 0;
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(async () => {
        attempt.current += 1;
        try {
          await tick();
        } finally {
          if (!cancelled) schedule();
        }
      }, retryDelay(attempt.current));
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [needsRetry, tick]);
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
  lines: PendingSale["lines"],
  // The signed-in user at the moment the sale is accepted. Immutable from here on.
  cashierId: string
): PendingSale {
  return {
    id,
    ...payment,
    lines,
    created_at: new Date().toISOString(),
    attempts: 0,
    cashier_id: cashierId,
  };
}
