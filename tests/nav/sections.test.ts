import {
  SECTIONS,
  allowedSections,
  canAccessPath,
  guardRedirect,
  phoneTabs,
  sectionForPath,
} from "../../src/lib/nav/sections";

describe("sections by role", () => {
  it("a cashier sees Vente and Clients only", () => {
    expect(allowedSections("cashier").map((s) => s.id)).toEqual(["sell", "clients"]);
  });

  it("the owner sees all six, in this order", () => {
    expect(allowedSections("owner").map((s) => s.id)).toEqual([
      "sell",
      "clients",
      "products",
      "stock",
      "reports",
      "settings",
    ]);
  });

  it("no role (profile not loaded) fails closed to the cashier set", () => {
    expect(allowedSections(null).map((s) => s.id)).toEqual(["sell", "clients"]);
  });

  it("the stock section's route is stock-in, and every section has an icon and a label key", () => {
    expect(SECTIONS.find((s) => s.id === "stock")?.route).toBe("/(app)/stock-in");
    for (const s of SECTIONS) {
      expect(s.icon).toBeTruthy();
      expect(s.labelKey).toMatch(/^nav\./);
    }
  });
});

describe("sectionForPath", () => {
  it.each([
    ["/sell", "sell"],
    ["/(app)/sell", "sell"],
    ["/sell/history", "sell"],
    ["/clients", "clients"],
    ["/products", "products"],
    ["/products/abc-123", "products"],
    ["/products/history/abc", "products"],
    ["/stock-in", "stock"],
    ["/stock-in/negative-stock", "stock"],
    ["/stock-in/delivery/42", "stock"],
    ["/reports", "reports"],
    ["/settings", "settings"],
    ["/dev-components", "dev"],
  ])("%s -> %s", (path, section) => {
    expect(sectionForPath(path)).toBe(section);
  });

  it.each(["/", "", "/sign-in", "/+not-found", "/nothing-here"])(
    "%j belongs to no section",
    (path) => {
      expect(sectionForPath(path)).toBeNull();
    }
  );

  it("does not match by prefix of a longer word", () => {
    expect(sectionForPath("/sellers")).toBeNull();
    expect(sectionForPath("/products-archive")).toBeNull();
  });
});

describe("the route guard (not just hidden tabs)", () => {
  const ownerOnly = [
    "/products",
    "/products/new",
    "/products/import",
    "/stock-in",
    "/stock-in/history",
    "/stock-in/adjust",
    "/stock-in/delivery/42",
    "/reports",
    "/settings",
    "/dev-components",
  ];

  it.each(ownerOnly)("a cashier is sent back to Vente from %s", (path) => {
    expect(canAccessPath("cashier", path)).toBe(false);
    expect(guardRedirect("cashier", path)).toBe("/(app)/sell");
  });

  it.each(ownerOnly)("the owner may open %s", (path) => {
    expect(canAccessPath("owner", path)).toBe(true);
    expect(guardRedirect("owner", path)).toBeNull();
  });

  it.each(["/sell", "/sell/history", "/clients"])("a cashier may open %s", (path) => {
    expect(guardRedirect("cashier", path)).toBeNull();
  });

  it("a missing profile is treated as a cashier", () => {
    expect(guardRedirect(null, "/reports")).toBe("/(app)/sell");
    expect(guardRedirect(null, "/sell")).toBeNull();
  });

  it("unknown paths are left to the not-found screen, not redirected", () => {
    expect(guardRedirect("cashier", "/nothing-here")).toBeNull();
  });
});

describe("phone tabs", () => {
  it("cashier: Vente and Clients, no More", () => {
    expect(phoneTabs("cashier")).toEqual({ tabs: ["sell", "clients"], more: [] });
  });

  it("owner: four tabs and a More holding Rapports and Réglages", () => {
    expect(phoneTabs("owner")).toEqual({
      tabs: ["sell", "clients", "products", "stock"],
      more: ["reports", "settings"],
    });
  });
});
