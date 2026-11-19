import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import {
  BASKET_MAX_AGE_MS,
  basketKey,
  restoreBasket,
  useBasket,
} from "../../src/lib/sales/basketStore";
import type { CartLine } from "../../src/lib/sales/totals";

const line = (id: string, quantity = 1): CartLine => ({
  product_id: id,
  name: `Product ${id}`,
  unit: "piece",
  quantity,
  unit_price_cents: 700,
  discount_cents: 0,
  unit_cost_cents: null,
  discountable: true,
});

let api: ReturnType<typeof useBasket>;
function Probe({ userId }: { userId: string | null }) {
  api = useBasket(userId);
  return null;
}

let tree: ReactTestRenderer | null = null;
const mount = async (userId: string | null) => {
  await act(async () => {
    tree = create(<Probe userId={userId} />);
  });
};
const unmount = () => act(() => tree?.unmount());
const flush = () => act(async () => {});

describe("restoreBasket", () => {
  const now = 1_000_000_000;
  const saved = (extra: object) => JSON.stringify({ savedAt: now, lines: [line("a")], ...extra });

  it("restores a recent basket", () => {
    expect(restoreBasket(saved({ saleDiscount: "2.00" }), now + 1000)).toEqual({
      lines: [line("a")],
      saleDiscount: "2.00",
    });
  });

  it("drops a basket older than the limit", () => {
    expect(restoreBasket(saved({}), now + BASKET_MAX_AGE_MS + 1)).toBeNull();
  });

  it("drops unreadable, empty or malformed baskets", () => {
    expect(restoreBasket(null, now)).toBeNull();
    expect(restoreBasket("{broken", now)).toBeNull();
    expect(restoreBasket(saved({ lines: [] }), now)).toBeNull();
    expect(restoreBasket(saved({ lines: [{ product_id: "a", quantity: "2" }] }), now)).toBeNull();
    expect(
      restoreBasket(saved({ lines: [{ ...line("a"), unit_price_cents: 1.5 }] }), now)
    ).toBeNull();
  });
});

describe("useBasket", () => {
  afterEach(() => unmount());

  it("keeps the basket when the screen closes and opens again (C3)", async () => {
    await mount("cashier-1");
    act(() => api.setLines([line("a"), line("b", 2)]));
    act(() => api.setSaleDiscount("1.00"));
    unmount();

    await mount("cashier-1");
    expect(api.lines).toEqual([line("a"), line("b", 2)]);
    expect(api.saleDiscount).toBe("1.00");
  });

  it("applies updates against the latest basket", async () => {
    await mount("cashier-1");
    act(() => {
      api.setLines((current) => [...current, line("a")]);
      api.setLines((current) => [...current, line("b")]);
    });
    expect(api.lines.map((l) => l.product_id)).toEqual(["a", "b"]);
  });

  it("never shows one user's basket to another", async () => {
    await mount("cashier-1");
    act(() => api.setLines([line("a")]));
    unmount();

    await mount("cashier-2");
    expect(api.lines).toEqual([]);
  });

  it("saves the basket on the device and forgets it once emptied", async () => {
    await mount("cashier-1");
    act(() => api.setLines([line("a")]));
    await flush();
    const raw = await AsyncStorage.getItem(basketKey("cashier-1"));
    expect(JSON.parse(raw!).lines).toEqual([line("a")]);

    act(() => api.setLines([]));
    await flush();
    expect(await AsyncStorage.getItem(basketKey("cashier-1"))).toBeNull();
  });

  it("restores a saved basket after a reload", async () => {
    await AsyncStorage.setItem(
      basketKey("cashier-1"),
      JSON.stringify({ savedAt: Date.now(), lines: [line("a")], saleDiscount: "" })
    );
    await mount("cashier-1");
    await flush();
    expect(api.lines).toEqual([line("a")]);
  });

  it("does nothing without a signed-in user", async () => {
    await mount(null);
    act(() => api.setLines([line("a")]));
    expect(api.lines).toEqual([]);
  });
});
