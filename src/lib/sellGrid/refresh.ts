// A change to the grid made on this device (O7) reaches Sell without a restart:
// the owner's save refreshes the offline cache, then tells a mounted Sell screen
// to reload the grid from it. Other devices pick the change up the next time
// their Sell screen comes online or opens (it refreshes the cache then).
import { refreshProductCache } from "@/src/lib/products/offlineCache";

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeGridRefresh(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Never throws: the change is saved on the server whatever happens to the cache.
export async function refreshGridCache(isOwner: boolean): Promise<void> {
  try {
    await refreshProductCache(isOwner);
    listeners.forEach((listener) => listener());
  } catch {
    // Offline: the cache keeps its older copy and refreshes when the device is online.
  }
}
