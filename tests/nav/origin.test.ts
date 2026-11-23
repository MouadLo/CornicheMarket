import {
  EMPTY_ORIGIN,
  backTarget,
  buildHref,
  getOrigin,
  hrefToLocation,
  recordLocation,
  resetOrigin,
  sectionOf,
  subscribeOrigin,
  trackLocation,
} from "../../src/lib/nav/origin";

describe("sectionOf", () => {
  it("is the first path segment, ignoring the query", () => {
    expect(sectionOf("/products/new?x=1")).toBe("products");
    expect(sectionOf("/competitors")).toBe("competitors");
    expect(sectionOf("/(app)/stock-in/low-stock")).toBe("stock-in");
    expect(sectionOf("/")).toBe("");
  });
});

describe("buildHref", () => {
  it("keeps search params", () => {
    expect(buildHref("/competitors", { tab: "sourcing", r: "5" })).toBe(
      "/competitors?tab=sourcing&r=5"
    );
  });
  it("drops dynamic-segment params already in the path, and empty ones", () => {
    expect(buildHref("/products/abc", { id: "abc", from: "" })).toBe("/products/abc");
    expect(buildHref("/sell/history", { from: "2026-01-01", x: undefined })).toBe(
      "/sell/history?from=2026-01-01"
    );
  });
  it("encodes values and repeats array values", () => {
    expect(buildHref("/a", { q: "a b&c", t: ["1", "2"] })).toBe("/a?q=a%20b%26c&t=1&t=2");
  });
});

describe("recordLocation", () => {
  it("starts with no previous location", () => {
    expect(recordLocation(EMPTY_ORIGIN, "/sell")).toEqual({ current: "/sell", previous: null });
  });
  it("records the previous location, with its params, when the section changes", () => {
    let s = recordLocation(EMPTY_ORIGIN, "/competitors?tab=tracked");
    s = recordLocation(s, "/competitors?tab=sourcing");
    s = recordLocation(s, "/products/new");
    expect(s).toEqual({ current: "/products/new", previous: "/competitors?tab=sourcing" });
  });
  it("ignores moves inside a section", () => {
    let s = recordLocation(EMPTY_ORIGIN, "/sell");
    s = recordLocation(s, "/products");
    s = recordLocation(s, "/products/abc");
    s = recordLocation(s, "/products/new");
    expect(s.previous).toBe("/sell");
  });
  it("is stable for the same location", () => {
    const s = recordLocation(EMPTY_ORIGIN, "/sell");
    expect(recordLocation(s, "/sell")).toBe(s);
  });
});

describe("backTarget", () => {
  const origin = { current: "/products/new", previous: "/competitors?tab=sourcing" };
  it("in a stack: the normal goBack", () => {
    expect(backTarget({ inStack: true, isRoot: false, pathname: "/products/abc", origin })).toEqual(
      { kind: "stack" }
    );
  });
  it("the root of a section: nothing", () => {
    expect(backTarget({ inStack: false, isRoot: true, pathname: "/competitors", origin })).toEqual({
      kind: "none",
    });
  });
  it("an orphan goes back to the exact previous location", () => {
    expect(
      backTarget({ inStack: false, isRoot: false, pathname: "/products/new", origin })
    ).toEqual({ kind: "href", href: "/competitors?tab=sourcing", fromOrigin: true });
  });
  it("an orphan with no origin (reload) goes to its section root", () => {
    expect(
      backTarget({
        inStack: false,
        isRoot: false,
        pathname: "/stock-in/negative-stock",
        origin: EMPTY_ORIGIN,
      })
    ).toEqual({ kind: "href", href: "/(app)/stock-in", fromOrigin: false });
  });
  it("an origin in the same section is not a target", () => {
    expect(
      backTarget({
        inStack: false,
        isRoot: false,
        pathname: "/products/new",
        origin: { current: "/products/new", previous: "/products" },
      })
    ).toEqual({ kind: "href", href: "/(app)/products", fromOrigin: false });
  });
  it("an unknown section has no target", () => {
    expect(
      backTarget({ inStack: false, isRoot: false, pathname: "/nope/x", origin: EMPTY_ORIGIN })
    ).toEqual({ kind: "none" });
  });
});

describe("store", () => {
  beforeEach(resetOrigin);
  it("tracks, notifies once per change, and resets", () => {
    const listener = jest.fn();
    const off = subscribeOrigin(listener);
    trackLocation("/sell");
    trackLocation("/sell");
    trackLocation("/reports");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getOrigin()).toEqual({ current: "/reports", previous: "/sell" });
    off();
    trackLocation("/products");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("hrefToLocation", () => {
  it("turns an href into the object form with the (app) group and its params", () => {
    expect(hrefToLocation("/competitors?tab=sourcing")).toEqual({
      pathname: "/(app)/competitors",
      params: { tab: "sourcing" },
    });
  });
  it("keeps a path without params, a section route and several params", () => {
    expect(hrefToLocation("/products/abc")).toEqual({
      pathname: "/(app)/products/abc",
      params: {},
    });
    expect(hrefToLocation("/(app)/stock-in")).toEqual({ pathname: "/(app)/stock-in", params: {} });
    expect(hrefToLocation("/sell/history?from=2026-11-01&to=2026-11-23")).toEqual({
      pathname: "/(app)/sell/history",
      params: { from: "2026-11-01", to: "2026-11-23" },
    });
  });
});
