/**
 * The "stuck offline" pill (audit C09): the app must recover without a reload.
 *
 * Found live: on web, NetInfo only listens to navigator.connection 'change',
 * which a desktop browser never fires when the network returns, so the pill
 * stayed "Hors ligne" forever and queued sales never left. NetInfo's own
 * isInternetReachable is not our backend either. Here nothing depends on a
 * NetInfo event: a real reachability check runs on a schedule while sales wait
 * or the app thinks it is offline, and again when the tab/app comes back.
 */
import React from "react";
import { act, create } from "react-test-renderer";

import { enqueueSale, listPendingSales, type PendingSale } from "../../src/lib/sales/offlineQueue";
import { pendingSaleFrom, useSaleSync } from "../../src/lib/sales/useSaleSync";

const mockSubmitSale = jest.fn();
const mockProbe = jest.fn();
let foreground: (() => void) | null = null;
let netInfoListener: ((s: object) => void) | null = null;

jest.mock("../../src/lib/sales/connectivity", () => ({
  ...jest.requireActual("../../src/lib/sales/connectivity"),
  probeReachable: () => mockProbe(),
  subscribeToForeground: (cb: () => void) => {
    foreground = cb;
    return () => {
      foreground = null;
    };
  },
}));
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    addEventListener: (cb: (s: object) => void) => {
      netInfoListener = cb;
      return () => {
        netInfoListener = null;
      };
    },
  },
}));
jest.mock("../../src/lib/sales/queries", () => ({
  submitSale: (...a: unknown[]) => mockSubmitSale(...a),
  fetchCustomers: jest.fn(),
  voidSale: jest.fn(),
}));
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    auth: {
      refreshSession: jest.fn(),
      getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }),
    },
  },
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ session: { user: { id: "user-1" } } }),
}));
const mockStore = new Map<string, string>();
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

const sale = (id: string): PendingSale =>
  pendingSaleFrom(
    id,
    { customer_id: null, payment_method: "cash", discount_cents: 0, total_cents: 700 },
    [
      {
        product_id: "p",
        name: "Milk",
        unit: "piece",
        quantity: 1,
        unit_price_cents: 700,
        discount_cents: 0,
        unit_cost_cents: null,
      },
    ],
    "user-1"
  );

let latest: ReturnType<typeof useSaleSync>;
let tree: ReturnType<typeof create>;
function Probe() {
  latest = useSaleSync();
  return null;
}
async function mount() {
  await act(async () => {
    tree = create(<Probe />);
  });
}
const advance = (ms: number) => act(async () => void (await jest.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  jest.useFakeTimers();
  mockStore.clear();
  mockSubmitSale.mockReset();
  mockProbe.mockReset();
  mockProbe.mockResolvedValue(true);
  foreground = null;
  netInfoListener = null;
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.useRealTimers();
});

describe("recovering without a NetInfo event", () => {
  it("offline → online with no event at all still syncs, and the pill recovers", async () => {
    await mount();
    await enqueueSale(sale("s1"));
    mockSubmitSale.mockResolvedValue(undefined);
    // The network drops: NetInfo says so once, and then never speaks again.
    await act(async () => netInfoListener?.({ isConnected: false, isInternetReachable: false }));
    mockProbe.mockResolvedValue(false);
    await advance(15000);
    expect(latest.online).toBe(false);

    mockProbe.mockResolvedValue(true); // back, and nobody tells the app
    await advance(60000);

    expect(latest.online).toBe(true);
    expect(mockSubmitSale).toHaveBeenCalledTimes(1);
    expect(await listPendingSales()).toEqual([]);
  });

  it("a sale queued while the connection is stable retries on its own", async () => {
    await mount();
    mockSubmitSale.mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValue(undefined);
    await enqueueSale(sale("s1"));
    await act(async () => void (await latest.sync()));
    expect(latest.pending).toBe(1);

    await advance(15000);

    expect(mockSubmitSale).toHaveBeenCalledTimes(2);
    expect(latest.pending).toBe(0);
  });

  it("coming back to the tab/app checks at once, without waiting for the timer", async () => {
    await mount();
    await enqueueSale(sale("s1"));
    mockSubmitSale.mockResolvedValue(undefined);
    mockProbe.mockResolvedValue(false);
    await act(async () => netInfoListener?.({ isConnected: false, isInternetReachable: false }));
    await act(async () => foreground?.());
    expect(latest.online).toBe(false);

    mockProbe.mockResolvedValue(true);
    await act(async () => foreground?.());

    expect(latest.online).toBe(true);
    expect(await listPendingSales()).toEqual([]);
  });

  it("does not trust isInternetReachable: connected + 'unreachable' but the server answers = online", async () => {
    await mount();
    await act(async () => netInfoListener?.({ isConnected: true, isInternetReachable: false }));
    expect(latest.online).toBe(true);
  });
});

describe("while really offline", () => {
  it("never calls the server for a sale (so retries cannot burn its attempts)", async () => {
    await mount();
    await enqueueSale(sale("s1"));
    mockProbe.mockResolvedValue(false);
    await act(async () => netInfoListener?.({ isConnected: false, isInternetReachable: false }));
    await advance(5 * 60000);
    expect(mockSubmitSale).not.toHaveBeenCalled();
    expect((await listPendingSales())[0].attempts).toBe(0);
  });

  it("probes on a 15s → 60s backoff", async () => {
    await mount();
    mockProbe.mockResolvedValue(false);
    await act(async () => netInfoListener?.({ isConnected: false, isInternetReachable: false }));
    mockProbe.mockClear();
    await advance(15000);
    expect(mockProbe).toHaveBeenCalledTimes(1);
    await advance(30000);
    expect(mockProbe).toHaveBeenCalledTimes(2);
    await advance(60000);
    expect(mockProbe).toHaveBeenCalledTimes(3);
    await advance(60000);
    expect(mockProbe).toHaveBeenCalledTimes(4);
  });
});

describe("Synchroniser maintenant", () => {
  it("works even when the app believes it is offline", async () => {
    await mount();
    await enqueueSale(sale("s1"));
    mockSubmitSale.mockResolvedValue(undefined);
    await act(async () => netInfoListener?.({ isConnected: false, isInternetReachable: false }));
    expect(latest.online).toBe(false);

    await act(async () => void (await latest.sync()));

    expect(latest.online).toBe(true);
    expect(mockSubmitSale).toHaveBeenCalledTimes(1);
    expect(latest.pending).toBe(0);
  });

  it("when the server really is unreachable it stays offline and touches no sale", async () => {
    await mount();
    await enqueueSale(sale("s1"));
    mockProbe.mockResolvedValue(false);
    await act(async () => void (await latest.sync()));
    expect(latest.online).toBe(false);
    expect(mockSubmitSale).not.toHaveBeenCalled();
    expect(latest.syncing).toBe(false);
  });
});
