import React from "react";
import { Pressable, StyleSheet, Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SellScreen from "../../app/(app)/sell/index";
import { ContinuousScanner } from "../../src/components/sell/ContinuousScanner";
import { PaymentSheet } from "../../src/components/sell/PaymentSheet";
import { enqueueSale } from "../../src/lib/sales/offlineQueue";
import { allTexts } from "./sellTestUtils";

// Products the device "knows" (the offline cache) and what the server would add.
const COCA = {
  id: "coca",
  name: "Coca-Cola 33cl",
  barcode: "611100",
  unit: "piece",
  selling_price_cents: 700,
};
const BARRE = {
  id: "barre",
  name: "Barre chocolatee",
  barcode: null,
  unit: "piece",
  selling_price_cents: 450,
};
const LAIT = {
  id: "lait",
  name: "Lait Centrale 1L",
  barcode: null,
  unit: "piece",
  selling_price_cents: 1200,
};
const CACHE = [BARRE, COCA, LAIT];

let mockDebounced = "";
let mockServer: unknown[] = [];
const mockSearchCached = jest.fn(async (term: string) =>
  CACHE.filter((p) => p.name.toLowerCase().includes(term.toLowerCase()))
);

jest.mock(
  "../../src/lib/loyalty/queries",
  () => require("../fixtures/loyaltyQueriesMock").loyaltyQueriesMock
);
// Sell imports the arrange save (it reaches Supabase); no test here saves a grid.
jest.mock("../../src/lib/sellGrid/queries", () => ({ saveGridArrangement: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "sale-id" }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key}|${Object.values(options).join("|")}` : key,
  }),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "cashier", role: "cashier" } }),
}));
jest.mock("../../src/lib/sales/useKeyboardWedge", () => ({ useKeyboardWedge: jest.fn() }));
jest.mock("../../src/lib/useDebouncedValue", () => ({ useDebouncedValue: () => mockDebounced }));
jest.mock("../../src/lib/products/offlineCache", () => ({
  getCachedGrid: async () => null,
  refreshProductCache: async () => {},
  getProductCacheMeta: async () => null,
  findCachedByBarcode: async () => null,
  searchCachedProducts: (term: string) => mockSearchCached(term),
}));
jest.mock("../../src/lib/products/queries", () => ({
  fetchProducts: async () => mockServer,
  fetchProductByBarcode: async (barcode: string) =>
    barcode === "611100"
      ? { id: "coca", name: "Coca-Cola 33cl", barcode, unit: "piece", selling_price_cents: 700 }
      : null,
  hasAnyProducts: async () => true,
}));
jest.mock("../../src/lib/sales/queries", () => ({ fetchCustomers: async () => [] }));
jest.mock("../../src/lib/sales/offlineQueue", () => ({ enqueueSale: jest.fn(async () => {}) }));
jest.mock("../../src/lib/sales/useSaleSync", () => ({
  useSaleSync: () => ({
    online: true,
    pending: 0,
    stuck: 0,
    syncing: false,
    sync: jest.fn(async () => {}),
  }),
  pendingSaleFrom: (id: string, payment: object, lines: unknown[]) => ({ id, ...payment, lines }),
}));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));
jest.mock("../../src/components/sell/PaymentSheet", () => ({ PaymentSheet: () => null }));

let tree: ReactTestRenderer;
beforeEach(() => {
  mockDebounced = "";
  mockServer = [];
  mockSearchCached.mockClear();
  jest.mocked(enqueueSale).mockClear();
});
afterEach(() => act(() => tree?.unmount()));

async function open() {
  await act(async () => {
    tree = create(<SellScreen />);
  });
}
const scan = (barcode: string) =>
  act(async () => {
    await tree.root.findByType(ContinuousScanner).props.onScanned(barcode);
  });
const searchBox = () => tree.root.findAllByType(TextInput)[0];
const type = async (text: string, debounced = text) => {
  mockDebounced = debounced;
  await act(async () => {
    searchBox().props.onChangeText(text);
  });
};
const sheet = () => tree.root.findByType(PaymentSheet);
const pay = (method: string, change: number) =>
  act(async () => {
    await sheet().props.onConfirm(method, null, change);
  });
const has = (text: string) => allTexts(tree.root).some((value) => value.includes(text));

describe("change due (UX review C2)", () => {
  it("stays on screen after a cash sale, until the next item or a dismissal", async () => {
    await open();
    await scan("611100");
    await pay("cash", 850);
    expect(enqueueSale).toHaveBeenCalledTimes(1);
    expect(has("sell.changeToGive")).toBe(true);
    expect(has("8.50 DH")).toBe(true);

    // The next customer's first item starts a new sale: the old change goes.
    await scan("611100");
    expect(has("sell.changeToGive")).toBe(false);
  });

  it("is dismissed with OK", async () => {
    await open();
    await scan("611100");
    await pay("cash", 850);
    const ok = tree.root
      .findAllByType(Pressable)
      .find((node) => allTexts(node).includes("sell.changeDone"))!;
    act(() => ok.props.onPress());
    expect(has("sell.changeToGive")).toBe(false);
  });

  it("is not shown for an exact amount, a card, or credit", async () => {
    await open();
    await scan("611100");
    await pay("cash", 0);
    expect(has("sell.changeToGive")).toBe(false);
    await scan("611100");
    await pay("card", 0);
    expect(has("sell.changeToGive")).toBe(false);
  });
});

describe("status line (UX review C6)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const flashTextStyle = (text: string) => {
    const node = tree.root
      .findAllByType(Text)
      .find((candidate) => [candidate.props.children].flat().join("").includes(text))!;
    return StyleSheet.flatten(node.props.style);
  };

  it("clears itself after a few seconds", async () => {
    await open();
    await scan("611100");
    expect(has("sell.added")).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(3100);
    });
    expect(has("sell.added")).toBe(false);
  });

  it("shows an unknown barcode as an error that stays longer", async () => {
    await open();
    await scan("000000");
    expect(has("sell.notFound")).toBe(true);
    expect(flashTextStyle("sell.notFound").color).toBe("#9a1f18"); // danger700
    await act(async () => {
      jest.advanceTimersByTime(3100);
    });
    expect(has("sell.notFound")).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(has("sell.notFound")).toBe(false);
  });

  it("shows a success in green, and the line's row is always there so nothing shifts", async () => {
    await open();
    const rowsBefore = tree.root.findAll(
      (node) => StyleSheet.flatten(node.props.style)?.minHeight === 22
    ).length;
    await scan("611100");
    expect(flashTextStyle("sell.added").color).toBe("#16653a"); // success700
    const rowsAfter = tree.root.findAll(
      (node) => StyleSheet.flatten(node.props.style)?.minHeight === 22
    ).length;
    expect(rowsBefore).toBeGreaterThan(0);
    expect(rowsAfter).toBe(rowsBefore);
  });
});

describe("search (UX review C7)", () => {
  it("lists names that start with the query before names that merely contain it", async () => {
    await open();
    await type("co");
    const names = allTexts(tree.root).filter((value) =>
      [COCA.name, BARRE.name].some((name) => value.includes(name))
    );
    expect(names[0]).toContain("Coca-Cola");
    expect(names[1]).toContain("Barre");
  });

  it("never shows the previous query's results while the new one is pending", async () => {
    await open();
    await type("lait");
    expect(has(LAIT.name)).toBe(true);

    // The cashier keeps typing; the debounced value has not caught up yet.
    await type("co", "lait");
    expect(has(LAIT.name)).toBe(false);

    // Once it catches up the right products show.
    await type("co ", "co"); // a trailing space re-renders; the trimmed query is the same
    expect(has(COCA.name)).toBe(true);
    expect(has(LAIT.name)).toBe(false);
  });

  it("says so when nothing matches, and asks the server only when the device knows nothing", async () => {
    await open();
    await type("zzz");
    expect(has("sell.noProductFound")).toBe(true);
    expect(mockSearchCached).toHaveBeenCalledWith("zzz");

    // A product added elsewhere since the last refresh: found through the server.
    mockServer = [{ ...LAIT, id: "new", name: "Zzzz Nouveau" }];
    await type("zzzz");
    expect(has("Zzzz Nouveau")).toBe(true);
  });

  it("clears the results when the box is emptied", async () => {
    await open();
    await type("co");
    expect(has(COCA.name)).toBe(true);
    await type("");
    expect(has(COCA.name)).toBe(false);
    expect(has("sell.noProductFound")).toBe(false);
  });
});
