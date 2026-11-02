import { AppState, Platform } from "react-native";

// How long to wait before the next reachability check while sales are waiting
// or the app thinks it is offline: 15s, 30s, then 60s for good.
const FIRST_DELAY_MS = 15_000;
const MAX_DELAY_MS = 60_000;
const PROBE_TIMEOUT_MS = 5_000;

export function retryDelay(attempt: number): number {
  return Math.min(FIRST_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

// Asks OUR backend, not a third party and not the OS: the question that matters
// is "can a sale reach Supabase right now". Any HTTP answer, even an error
// status, proves the way is open; only a network failure or a timeout does not.
export async function probeReachable(): Promise<boolean> {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(`${base}/auth/v1/health`, {
      method: "GET",
      cache: "no-store",
      headers: { apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "" },
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Calls back when the app may have regained the network or the user's eyes: the
// browser tab becomes visible or focused, or reports online/offline; on a phone,
// the app returns to the foreground. NetInfo alone misses these on the web.
export function subscribeToForeground(callback: () => void): () => void {
  if (Platform.OS === "web" && typeof document !== "undefined") {
    const onVisible = () => {
      if (document.visibilityState === "visible") callback();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", callback);
    window.addEventListener("online", callback);
    window.addEventListener("offline", callback);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", callback);
      window.removeEventListener("online", callback);
      window.removeEventListener("offline", callback);
    };
  }
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") callback();
  });
  return () => subscription.remove();
}
