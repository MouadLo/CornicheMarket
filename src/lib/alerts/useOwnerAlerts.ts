import { useCallback, useEffect, useState } from "react";

import { NO_ALERTS, fetchAlertCounts, type AlertCounts } from "@/src/lib/alerts/queries";

const REFRESH_MS = 60_000;

// Counts for the top bar's alert button. Owner only (a cashier is never asked),
// only while online, refreshed every minute and on demand after a dismissal.
export function useOwnerAlerts(enabled: boolean, online: boolean) {
  const [counts, setCounts] = useState<AlertCounts>(NO_ALERTS);

  const refresh = useCallback(async () => {
    if (!enabled || !online) return;
    try {
      setCounts(await fetchAlertCounts());
    } catch {
      // A failed refresh keeps the last known counts; the alert button is not
      // the place to show a network error.
    }
  }, [enabled, online]);

  useEffect(() => {
    if (!enabled) {
      setCounts(NO_ALERTS);
      return;
    }
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled, refresh]);

  return { counts, refresh };
}
