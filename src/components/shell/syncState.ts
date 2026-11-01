import type { SyncPillState } from "./TopBar";

// Mirrors what useSaleSync returns, so the shell and its menus can be tested
// without the hook.
export type SaleSyncState = {
  online: boolean;
  pending: number;
  // Sales on this device that belong to other users (or are legacy).
  others: number;
  stuck: number;
  syncing: boolean;
  lastError: string | null;
};

type T = (key: string, options?: Record<string, unknown>) => string;

// What the top bar's pill says. A stuck sale is the loudest state, but only
// the owner is told: a cashier cannot act on it.
export function syncPill(state: SaleSyncState, isOwner: boolean, t: T): SyncPillState {
  if (isOwner && state.stuck > 0) {
    return { tone: "bad", icon: "alert", label: t("sell.stuckBanner", { count: state.stuck }) };
  }
  if (state.syncing) return { tone: "info", icon: "refresh", label: t("sell.syncSyncing") };
  if (!state.online) {
    return {
      tone: "warn",
      icon: "wifiOff",
      label:
        state.pending > 0
          ? t("sell.syncOfflineQueued", { count: state.pending })
          : t("sell.syncOffline"),
    };
  }
  if (state.pending > 0)
    return {
      tone: "warn",
      icon: "refresh",
      label: t("sell.syncPending", { count: state.pending }),
    };
  return { tone: "ok", icon: "check", label: t("sell.syncOnline") };
}
