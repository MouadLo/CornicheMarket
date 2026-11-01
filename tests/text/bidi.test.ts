import { appDirection, isolateBidi, isolateLtr } from "../../src/lib/text/bidi";

describe("isolateBidi", () => {
  it("wraps text in the First Strong Isolate / Pop Directional Isolate pair", () => {
    expect(isolateBidi("عصير برتقال")).toBe("⁨عصير برتقال⁩");
  });

  it("wraps French/Latin text identically (no-op visually, still isolated)", () => {
    expect(isolateBidi("Coca-Cola 33cl")).toBe("⁨Coca-Cola 33cl⁩");
  });

  it("preserves the exact original text between the isolate markers", () => {
    const name = "Boisson energetique Format Familial";
    const wrapped = isolateBidi(name);
    expect(wrapped.slice(1, -1)).toBe(name);
  });
});

describe("appDirection", () => {
  it("is rtl for Arabic", () => {
    expect(appDirection("ar")).toBe("rtl");
  });

  it("is ltr for French and English", () => {
    expect(appDirection("fr")).toBe("ltr");
    expect(appDirection("en")).toBe("ltr");
  });

  it("defaults to ltr for any other/unknown language code", () => {
    expect(appDirection("es")).toBe("ltr");
    expect(appDirection("")).toBe("ltr");
  });
});

describe("isolateLtr", () => {
  it("wraps text in a left-to-right isolate and keeps it intact", () => {
    const out = isolateLtr("0661 23 45 67");
    expect(out.startsWith("\u2066")).toBe(true);
    expect(out.endsWith("\u2069")).toBe(true);
    expect(out.slice(1, -1)).toBe("0661 23 45 67");
  });
});
