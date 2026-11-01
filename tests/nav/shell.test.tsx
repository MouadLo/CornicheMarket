import React from "react";
import { Dimensions, Platform } from "react-native";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import { AppShell } from "../../src/components/shell/AppShell";
import AppLayout from "../../app/(app)/_layout";
import { __resetForTests } from "../../src/lib/dialog/store";

let mockPathname = "/sell";
let mockProfile: { id: string; role: "owner" | "cashier"; full_name: string } | null = null;
let mockSync = {
  online: true,
  pending: 0,
  stuck: 0,
  syncing: false,
  lastError: null as string | null,
};
let mockCounts = { price: 0, discount: 0, negativeStock: 0 };
const mockNavigate = jest.fn();
const mockFetchReview = jest.fn();
const mockDismiss = jest.fn();

jest.mock("expo-router", () => {
  const React = require("react");
  return {
    usePathname: () => mockPathname,
    router: { navigate: (...a: unknown[]) => mockNavigate(...a) },
    Redirect: ({ href }: { href: string }) => React.createElement("Redirect", { href }),
    Slot: () => React.createElement("Slot"),
  };
});
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k),
    i18n: { language: "fr" },
  }),
}));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0 }),
}));
jest.mock("react-native-svg", () => {
  const React = require("react");
  const make = (n: string) => (p: object) => React.createElement(n, p);
  return {
    __esModule: true,
    default: make("Svg"),
    Circle: make("Circle"),
    ClipPath: make("ClipPath"),
    Defs: make("Defs"),
    G: make("G"),
    Path: make("Path"),
    Rect: make("Rect"),
  };
});
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: mockProfile, signOut: jest.fn() }),
}));
jest.mock("../../src/lib/sales/useSaleSync", () => ({
  useSaleSync: () => ({ ...mockSync, sync: jest.fn(), refreshPending: jest.fn() }),
}));
jest.mock("../../src/lib/alerts/useOwnerAlerts", () => ({
  useOwnerAlerts: (enabled: boolean) => ({
    counts: enabled ? mockCounts : { price: 0, discount: 0, negativeStock: 0 },
    refresh: jest.fn(),
  }),
}));
jest.mock("../../src/lib/alerts/queries", () => ({
  ...jest.requireActual("../../src/lib/alerts/queries"),
  fetchReviewSales: (...a: unknown[]) => mockFetchReview(...a),
  dismissReview: (...a: unknown[]) => mockDismiss(...a),
}));
jest.mock("../../src/lib/products/offlineCache", () => ({
  getProductCacheMeta: async () => ({ refreshedAt: "2026-11-01T14:20:00" }),
}));
jest.mock("../../src/lib/sales/offlineQueue", () => ({
  listStuckSales: async () => [],
  retryStuckSale: jest.fn(),
  dismissStuckSale: jest.fn(),
}));
jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("../../src/i18n", () => ({ changeLanguage: jest.fn(async () => false) }));

const texts = (n: ReactTestInstance) =>
  n.findAll((x) => (x.type as unknown) === "Text").map((x) => x.children.join(""));
const tabsOf = (r: ReturnType<typeof create>) =>
  r.root.findAll((n) => typeof n.type === "string" && n.props.accessibilityRole === "tab");
const labelsOf = (r: ReturnType<typeof create>) => [
  ...new Set(tabsOf(r).map((n) => n.props.accessibilityLabel)),
];
const byLabel = (r: ReturnType<typeof create>, label: string | RegExp) =>
  r.root.findAll(
    (n) =>
      typeof n.props.onPress === "function" &&
      (typeof label === "string"
        ? n.props.accessibilityLabel === label
        : label.test(n.props.accessibilityLabel ?? ""))
  );

const mounted: ReturnType<typeof create>[] = [];
async function render(el: React.ReactElement) {
  let r!: ReturnType<typeof create>;
  await act(async () => {
    r = create(el);
  });
  mounted.push(r);
  return r;
}
const setWidth = (width: number) =>
  jest.spyOn(Dimensions, "get").mockReturnValue({ width, height: 768, scale: 1, fontScale: 1 });
const owner = { id: "o", role: "owner" as const, full_name: "Mouad" };
const cashier = { id: "c", role: "cashier" as const, full_name: "Salma" };

beforeEach(() => {
  mockPathname = "/sell";
  mockProfile = cashier;
  mockSync = { online: true, pending: 0, stuck: 0, syncing: false, lastError: null };
  mockCounts = { price: 0, discount: 0, negativeStock: 0 };
  mockNavigate.mockClear();
  mockFetchReview.mockReset();
  mockDismiss.mockReset();
  setWidth(1366);
});
afterEach(() => {
  // The clock and the counts poll keep timers: unmount every tree.
  act(() => mounted.splice(0).forEach((r) => r.unmount()));
  __resetForTests(); // the toast keeps a 5 s timer
  jest.restoreAllMocks();
});

describe("navigation by role (laptop and tablet, >= 900 dp)", () => {
  it("a cashier's rail has Vente and Clients only", async () => {
    const r = await render(
      <AppShell>
        <></>
      </AppShell>
    );
    expect(labelsOf(r)).toEqual(["nav.sell", "nav.clients"]);
  });

  it("the owner's rail has all six sections", async () => {
    mockProfile = owner;
    const r = await render(
      <AppShell>
        <></>
      </AppShell>
    );
    expect(labelsOf(r)).toEqual([
      "nav.sell",
      "nav.clients",
      "nav.products",
      "nav.stockIn",
      "nav.reports",
      "nav.settings",
    ]);
  });

  it("marks the section being viewed, including sub-pages", async () => {
    mockProfile = owner;
    mockPathname = "/stock-in/history";
    const r = await render(
      <AppShell>
        <></>
      </AppShell>
    );
    const selected = tabsOf(r)
      .filter((n) => n.props.accessibilityState?.selected)
      .map((n) => n.props.accessibilityLabel);
    expect([...new Set(selected)]).toEqual(["nav.stockIn"]);
  });

  it("tapping a section navigates to its route", async () => {
    mockProfile = owner;
    const r = await render(
      <AppShell>
        <></>
      </AppShell>
    );
    await act(async () => byLabel(r, "nav.clients")[0].props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith("/(app)/clients");
  });
});

describe("navigation on a phone (< 900 dp)", () => {
  beforeEach(() => setWidth(390));

  it("a cashier gets two bottom tabs and no More", async () => {
    const r = await render(
      <AppShell>
        <></>
      </AppShell>
    );
    expect(labelsOf(r)).toEqual(["nav.sell", "nav.clients"]);
  });

  it("the owner gets four tabs plus More, which holds Rapports and Réglages", async () => {
    mockProfile = owner;
    const r = await render(
      <AppShell>
        <></>
      </AppShell>
    );
    expect(labelsOf(r)).toEqual([
      "nav.sell",
      "nav.clients",
      "nav.products",
      "nav.stockIn",
      "shell.more",
    ]);
    await act(async () => byLabel(r, "shell.more")[0].props.onPress());
    expect(texts(r.root)).toEqual(expect.arrayContaining(["nav.reports", "nav.settings"]));
  });
});

describe("the route guard in the layout", () => {
  it("sends a cashier who opens an owner-only URL back to Vente", async () => {
    mockPathname = "/reports";
    const r = await render(<AppLayout />);
    expect(r.root.findByType("Redirect" as never).props.href).toBe("/(app)/sell");
    expect(r.root.findAllByType("Slot" as never)).toHaveLength(0);
  });

  it.each(["/products/new", "/stock-in/adjust", "/settings", "/dev-components"])(
    "also guards %s",
    async (path) => {
      mockPathname = path;
      const r = await render(<AppLayout />);
      expect(r.root.findByType("Redirect" as never).props.href).toBe("/(app)/sell");
    }
  );

  it("lets the owner in, inside the shell", async () => {
    mockProfile = owner;
    mockPathname = "/reports";
    const r = await render(<AppLayout />);
    expect(r.root.findAllByType("Redirect" as never)).toHaveLength(0);
    expect(r.root.findAllByType("Slot" as never)).toHaveLength(1);
  });

  it("lets a cashier into Clients and Vente", async () => {
    for (const path of ["/clients", "/sell/history"]) {
      mockPathname = path;
      const r = await render(<AppLayout />);
      expect(r.root.findAllByType("Redirect" as never)).toHaveLength(0);
    }
  });
});

describe("the top bar", () => {
  it("shows the store, the user and their role", async () => {
    const r = await render(
      <AppShell>
        <></>
      </AppShell>
    );
    const all = texts(r.root);
    expect(all).toEqual(expect.arrayContaining(["shell.storeName", "Salma", "shell.roleCashier"]));
  });

  it("shows the scanner status only on Sell, on a laptop (web)", async () => {
    const original = Platform.OS;
    Platform.OS = "web";
    try {
      let r = await render(
        <AppShell>
          <></>
        </AppShell>
      );
      expect(texts(r.root)).toContain("shell.scannerReady");
      mockPathname = "/clients";
      r = await render(
        <AppShell>
          <></>
        </AppShell>
      );
      expect(texts(r.root)).not.toContain("shell.scannerReady");
    } finally {
      Platform.OS = original;
    }
  });

  it("a cashier has no alert button; the owner has one with the total count", async () => {
    let r = await render(
      <AppShell>
        <></>
      </AppShell>
    );
    expect(byLabel(r, /^shell\.alertsLabel/)).toHaveLength(0);

    mockProfile = owner;
    mockCounts = { price: 2, discount: 1, negativeStock: 3 };
    mockSync = { ...mockSync, stuck: 1 };
    r = await render(
      <AppShell>
        <></>
      </AppShell>
    );
    expect(byLabel(r, 'shell.alertsLabel{"count":7}').length).toBeGreaterThan(0);
  });

  it("the pill reflects online, offline-with-queue, and a stuck sale (owner only)", async () => {
    let r = await render(
      <AppShell>
        <></>
      </AppShell>
    );
    expect(byLabel(r, "sell.syncOnline").length).toBeGreaterThan(0);

    mockSync = { ...mockSync, online: false, pending: 3 };
    r = await render(
      <AppShell>
        <></>
      </AppShell>
    );
    expect(byLabel(r, 'sell.syncOfflineQueued{"count":3}').length).toBeGreaterThan(0);

    mockSync = { online: true, pending: 0, stuck: 2, syncing: false, lastError: null };
    r = await render(
      <AppShell>
        <></>
      </AppShell>
    );
    expect(byLabel(r, /stuckBanner/)).toHaveLength(0); // the cashier is not shown it
    mockProfile = owner;
    r = await render(
      <AppShell>
        <></>
      </AppShell>
    );
    expect(byLabel(r, 'sell.stuckBanner{"count":2}').length).toBeGreaterThan(0);
  });

  it("shows the offline banner with the age of the prices, only when offline", async () => {
    let r = await render(
      <AppShell>
        <></>
      </AppShell>
    );
    expect(texts(r.root).join("|")).not.toContain("states.offlinePrices");
    mockSync = { ...mockSync, online: false };
    r = await render(
      <AppShell>
        <></>
      </AppShell>
    );
    expect(texts(r.root)).toContain('states.offlinePrices{"time":"14:20"}');
  });
});

describe("the owner's alerts", () => {
  beforeEach(() => {
    mockProfile = owner;
    mockCounts = { price: 2, discount: 1, negativeStock: 3 };
    mockSync = { ...mockSync, stuck: 1 };
  });

  async function openAlerts() {
    const r = await render(
      <AppShell>
        <></>
      </AppShell>
    );
    await act(async () => byLabel(r, /^shell\.alertsLabel/)[0].props.onPress());
    return r;
  }

  it("lists each kind that needs attention, with its count", async () => {
    const r = await openAlerts();
    expect(texts(r.root)).toEqual(
      expect.arrayContaining([
        "shell.alertPrice",
        "shell.alertDiscount",
        "shell.alertNegative",
        "shell.alertStuck",
        "2",
        "1",
        "3",
      ])
    );
  });

  it("hides kinds with nothing to do, and says so when all are clear", async () => {
    mockCounts = { price: 0, discount: 1, negativeStock: 0 };
    mockSync = { ...mockSync, stuck: 0 };
    let r = await openAlerts();
    expect(texts(r.root)).not.toContain("shell.alertPrice");
    expect(texts(r.root)).toContain("shell.alertDiscount");

    mockCounts = { price: 0, discount: 0, negativeStock: 0 };
    r = await openAlerts();
    expect(texts(r.root)).toContain("shell.alertsNone");
  });

  it("negative stock opens the negative-stock screen", async () => {
    const r = await openAlerts();
    const row = r.root.findAll(
      (n) => typeof n.props.onPress === "function" && texts(n).includes("shell.alertNegative")
    );
    await act(async () => row[row.length - 1].props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith("/(app)/stock-in/negative-stock");
  });

  it("price review lists the flagged sales and a dismiss removes the sale from the list", async () => {
    mockFetchReview.mockResolvedValue([
      {
        saleId: "s1",
        occurredAt: "2026-11-01T10:00:00",
        totalCents: 300,
        cashierName: "Salma",
        lines: [
          { type: "price", name: "Pain rond", deviceCents: 100, expectedCents: 120, stale: true },
        ],
      },
    ]);
    mockDismiss.mockResolvedValue(undefined);

    const r = await openAlerts();
    const row = r.root.findAll(
      (n) => typeof n.props.onPress === "function" && texts(n).includes("shell.alertPrice")
    );
    await act(async () => row[row.length - 1].props.onPress());

    expect(mockFetchReview).toHaveBeenCalledWith("price");
    const all = texts(r.root).join("|");
    expect(all).toContain("shell.priceLineStale");
    expect(all).toContain("shell.reviewPriceTitle");

    const dismiss = r.root.findAll(
      (n) => typeof n.props.onPress === "function" && texts(n).includes("shell.reviewDismiss")
    );
    await act(async () => dismiss[dismiss.length - 1].props.onPress());
    expect(mockDismiss).toHaveBeenCalledWith("price", "s1");
    expect(texts(r.root)).toContain("shell.reviewEmpty");
  });

  it("a failed load shows the retry state, never a raw error", async () => {
    mockFetchReview.mockRejectedValue(new Error("TypeError: Failed to fetch"));
    const r = await openAlerts();
    const row = r.root.findAll(
      (n) => typeof n.props.onPress === "function" && texts(n).includes("shell.alertDiscount")
    );
    await act(async () => row[row.length - 1].props.onPress());
    const all = texts(r.root).join("|");
    expect(all).toContain("common.retry");
    expect(all).not.toContain("Failed to fetch");
  });
});
