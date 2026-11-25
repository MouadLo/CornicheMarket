import {
  clampQty,
  kitStatus,
  kitStatuses,
  newKitId,
  orderedItems,
  overLimitKitIds,
  validateKit,
} from "../../src/lib/webstore/kits";
import type { WebKit, WebKitItem } from "../../src/lib/webstore/types";
import { linkedProduct, webProduct } from "./helpers";

const item = (id: string, qty = 1, sort = 0): WebKitItem => ({
  web_product_id: id,
  qty,
  sort,
});
const kit = (over: Partial<WebKit> = {}): WebKit => ({
  id: "kit_a",
  name: "A",
  name_fr: null,
  published: true,
  sort: 0,
  items: [item("p001")],
  ...over,
});

const p1 = webProduct({ id: "p001", price_cents: 500 });
const p2 = webProduct({ id: "p002", price_cents: 250 });

describe("kitStatus", () => {
  it("shows a kit whose lines are all in the feed, in stock and priced; price is the sum", () => {
    const s = kitStatus(kit(), [item("p001", 2), item("p002", 3)], [p1, p2]);
    expect(s).toEqual({ priceCents: 1750, shownOnSite: true, problems: [] });
  });

  it("flags a line that is not in the list as missing and has no price", () => {
    const s = kitStatus(kit(), [item("p001"), item("p020")], [p1]);
    expect(s.shownOnSite).toBe(false);
    expect(s.priceCents).toBeNull();
    expect(s.problems).toEqual([{ kind: "missing", webProductId: "p020" }]);
  });

  it("flags hidden (unpublished) lines", () => {
    const s = kitStatus(kit(), [item("p001")], [{ ...p1, published: false }]);
    expect(s.problems).toEqual([{ kind: "hidden", webProductId: "p001" }]);
    expect(s.shownOnSite).toBe(false);
    // the price is still known
    expect(s.priceCents).toBe(500);
  });

  it("flags a published line the feed drops (inactive or Divers app product)", () => {
    const inactive = linkedProduct({ id: "p001" }, { active: false });
    const misc = linkedProduct({ id: "p002" }, { id: "a2", kind: "misc" });
    expect(kitStatus(kit(), [item("p001")], [inactive]).problems).toEqual([
      { kind: "excluded", webProductId: "p001" },
    ]);
    expect(kitStatus(kit(), [item("p002")], [misc]).problems).toEqual([
      { kind: "excluded", webProductId: "p002" },
    ]);
  });

  it("flags sold-out lines, by the manual switch and by the app stock", () => {
    const manual = { ...p1, manual_in_stock: false };
    const auto = linkedProduct({ id: "p002", stock_mode: "auto" }, { id: "a2", stock_quantity: 0 });
    expect(kitStatus(kit(), [item("p001")], [manual]).problems[0]).toEqual({
      kind: "soldOut",
      webProductId: "p001",
    });
    expect(kitStatus(kit(), [item("p002")], [auto]).problems[0]).toEqual({
      kind: "soldOut",
      webProductId: "p002",
    });
  });

  it("flags a line without a price and gives no kit price", () => {
    const s = kitStatus(kit(), [item("p001"), item("p002")], [p1, { ...p2, price_cents: null }]);
    expect(s.problems).toEqual([{ kind: "noPrice", webProductId: "p002" }]);
    expect(s.priceCents).toBeNull();
    expect(s.shownOnSite).toBe(false);
  });

  it("reports one problem per line, the first in the order missing > hidden > excluded > soldOut > noPrice", () => {
    const both = { ...p1, price_cents: null, manual_in_stock: false };
    expect(kitStatus(kit(), [item("p001")], [both]).problems).toEqual([
      { kind: "soldOut", webProductId: "p001" },
    ]);
  });

  it("an unpublished kit is not shown, an empty kit is not shown", () => {
    expect(kitStatus(kit({ published: false }), [item("p001")], [p1])).toMatchObject({
      shownOnSite: false,
      problems: [{ kind: "unpublished" }],
    });
    const empty = kitStatus(kit({ items: [] }), [], [p1]);
    expect(empty.shownOnSite).toBe(false);
    expect(empty.problems).toEqual([{ kind: "empty" }]);
    expect(empty.priceCents).toBeNull();
  });

  it("an over-limit kit is not shown and says so first", () => {
    const s = kitStatus(kit(), [item("p001")], [p1], true);
    expect(s.shownOnSite).toBe(false);
    expect(s.problems).toEqual([{ kind: "overLimit" }]);
  });

  it("only the first 12 lines (by sort, then id) count; the others are flagged but never hide the kit", () => {
    const products = Array.from({ length: 13 }, (_, i) =>
      webProduct({ id: `p${String(i + 1).padStart(3, "0")}`, price_cents: 100 })
    );
    // the 13th line is sold out and not even read by the page
    products[12] = { ...products[12], manual_in_stock: false };
    const lines = products.map((p, i) => item(p.id, 1, i));
    const s = kitStatus(kit(), lines, products);
    expect(s.shownOnSite).toBe(true);
    expect(s.priceCents).toBe(1200);
    expect(s.problems).toEqual([{ kind: "tooManyItems", webProductId: "p013" }]);
  });

  it("lines are read in sort order, not array order", () => {
    expect(
      orderedItems([item("b", 1, 1), item("a", 1, 1), item("c", 1, 0)]).map((i) => i.web_product_id)
    ).toEqual(["c", "a", "b"]);
  });
});

describe("the 20-kit limit", () => {
  const many = (n: number, over: (i: number) => Partial<WebKit> = () => ({})): WebKit[] =>
    Array.from({ length: n }, (_, i) =>
      kit({ id: `kit_${String(i).padStart(2, "0")}`, sort: i, ...over(i) })
    );

  it("counts published kits with lines, by sort then id; the 21st is over the limit", () => {
    const kits = many(22);
    expect([...overLimitKitIds(kits)].sort()).toEqual(["kit_20", "kit_21"]);
  });

  it("unpublished and empty kits do not take a place", () => {
    const kits = many(24, (i) => (i < 2 ? { published: false } : i === 2 ? { items: [] } : {}));
    expect(overLimitKitIds(kits).size).toBe(1);
  });

  it("a kit the page hides for a bad line still takes its place", () => {
    const kits = many(21, (i) => (i === 0 ? { items: [item("p999")] } : {}));
    expect([...overLimitKitIds(kits)]).toEqual(["kit_20"]);
  });

  it("kitStatuses applies it", () => {
    const kits = many(21);
    const map = kitStatuses(kits, [p1]);
    expect(map.get("kit_00")?.shownOnSite).toBe(true);
    expect(map.get("kit_20")?.shownOnSite).toBe(false);
    expect(map.get("kit_20")?.problems[0]).toEqual({ kind: "overLimit" });
  });
});

describe("newKitId", () => {
  it("makes kit_<slug>: lowercase ASCII, accents removed, other characters become _", () => {
    expect(newKitId("Pack Goûter & Café!", [])).toBe("kit_pack_gouter_cafe");
    expect(newKitId("  --Été  2026--  ", [])).toBe("kit_ete_2026");
  });

  it("stays within 40 characters", () => {
    const id = newKitId("a".repeat(100), []);
    expect(id.length).toBe(40);
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
  });

  it("is unique with _2, _3, ... (case-insensitive), still within 40", () => {
    expect(newKitId("Goûter", ["kit_gouter"])).toBe("kit_gouter_2");
    expect(newKitId("Goûter", ["kit_gouter", "KIT_GOUTER_2"])).toBe("kit_gouter_3");
    const long = newKitId("a".repeat(100), []);
    const next = newKitId("a".repeat(100), [long]);
    expect(next.length).toBeLessThanOrEqual(40);
    expect(next.endsWith("_2")).toBe(true);
    const tenth = newKitId("a".repeat(100), [
      long,
      ...Array.from({ length: 8 }, (_, i) => `${long.slice(0, 38)}_${i + 2}`),
    ]);
    expect(tenth.length).toBeLessThanOrEqual(40);
  });

  it("a name with no usable letter gives kit", () => {
    expect(newKitId("طقم", [])).toBe("kit");
    expect(newKitId("طقم", ["kit"])).toBe("kit_2");
    expect(newKitId("", [])).toBe("kit");
  });
});

describe("validateKit", () => {
  const ok = { name: " Pack ", nameFr: " ", items: [{ web_product_id: "p001", qty: 2 }] };

  it("trims, and stores an empty French name as null", () => {
    expect(validateKit(ok)).toEqual({ errors: {}, patch: { name: "Pack", name_fr: null } });
  });

  it("requires the name, at most 60 characters (both names)", () => {
    expect(validateKit({ ...ok, name: "  " }).errors.name).toBe("webstore.kits.errNameRequired");
    expect(validateKit({ ...ok, name: "x".repeat(61) }).errors.name).toBe(
      "webstore.kits.errNameTooLong"
    );
    expect(validateKit({ ...ok, name: "x".repeat(60) }).patch).not.toBeNull();
    expect(validateKit({ ...ok, nameFr: "x".repeat(61) }).errors.nameFr).toBe(
      "webstore.kits.errNameTooLong"
    );
  });

  it("qty between 1 and 10, at most 12 lines", () => {
    const line = (qty: number) => ({ web_product_id: "p", qty });
    expect(validateKit({ ...ok, items: [line(0)] }).errors.qty).toBeDefined();
    expect(validateKit({ ...ok, items: [line(11)] }).errors.qty).toBeDefined();
    expect(validateKit({ ...ok, items: [line(1.5)] }).errors.qty).toBeDefined();
    expect(validateKit({ ...ok, items: [line(10)] }).patch).not.toBeNull();
    expect(
      validateKit({ ...ok, items: Array.from({ length: 13 }, () => line(1)) }).errors.items
    ).toBeDefined();
    expect(
      validateKit({ ...ok, items: Array.from({ length: 12 }, () => line(1)) }).patch
    ).not.toBeNull();
  });

  it("clampQty keeps 1..10", () => {
    expect([clampQty(0), clampQty(5), clampQty(11), clampQty(2.4)]).toEqual([1, 5, 10, 2]);
  });
});
