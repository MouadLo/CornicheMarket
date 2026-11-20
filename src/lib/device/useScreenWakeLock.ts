import { useEffect, useState } from "react";
import { Platform } from "react-native";

type WakeLockSentinelLike = { release: () => Promise<void> };

// Web only: asks the browser to keep the screen on (Screen Wake Lock API) and
// asks again whenever the page becomes visible. Returns whether the page is
// hidden right now, so the caller can warn. Refusals are swallowed.
export function useScreenWakeLock(enabled: boolean): { hidden: boolean } {
  const isWeb = Platform.OS === "web" && typeof document !== "undefined";
  const [hidden, setHidden] = useState(isWeb ? document.hidden : false);

  useEffect(() => {
    if (!enabled || !isWeb) return;
    let lock: WakeLockSentinelLike | null = null;
    let stopped = false;
    const acquire = async () => {
      const wakeLock = (
        navigator as unknown as {
          wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
        }
      ).wakeLock;
      if (!wakeLock || document.hidden) return;
      try {
        const next = await wakeLock.request("screen");
        if (stopped) await next.release().catch(() => {});
        else lock = next;
      } catch {
        // Not allowed right now: try again at the next visibility change.
      }
    };
    const onVisibility = () => {
      setHidden(document.hidden);
      if (!document.hidden) void acquire();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void acquire();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => {});
    };
  }, [enabled, isWeb]);

  return { hidden };
}
