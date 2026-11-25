import {
  buildMatchReport,
  matchReportToCsv,
  summarizeMatchReport,
  webMatchName,
  type AppProductInput,
  type WebProductInput,
} from "../../src/lib/webstore/matchReport";

const web = (over: Partial<WebProductInput> & { id: string; name: string }): WebProductInput => ({
  name_fr: null,
  size: null,
  price_cents: null,
  ...over,
});
const app = (over: Partial<AppProductInput> & { id: string; name: string }): AppProductInput => ({
  selling_price_cents: null,
  active: true,
  kind: "standard",
  ...over,
});

const apps: AppProductInput[] = [
  app({ id: "a-sidi15", name: "SIDI ALI PET 1.50L", selling_price_cents: 600 }),
  app({ id: "a-sidi05", name: "SIDI ALI PET 0.50L", selling_price_cents: 300 }),
  app({ id: "a-coca", name: "COCA COLA 33CL", selling_price_cents: 500 }),
  app({ id: "a-old", name: "FANTA 33CL", selling_price_cents: 500, active: false }),
  app({ id: "a-misc", name: "DIVERS", kind: "misc" }),
];

describe("webMatchName", () => {
  it("prefers name_fr and appends the size once", () => {
    expect(webMatchName({ name: "Water", name_fr: "Eau Sidi Ali", size: "1.5 L" })).toBe(
      "Eau Sidi Ali 1.5 L"
    );
    expect(webMatchName({ name: "Water", name_fr: null, size: null })).toBe("Water");
    expect(webMatchName({ name: "x", name_fr: "Sidi Ali 1.5 L", size: "1.5 L" })).toBe(
      "Sidi Ali 1.5 L"
    );
  });
});

describe("buildMatchReport", () => {
  const rows = buildMatchReport(
    [
      web({ id: "w1", name: "Water", name_fr: "Sidi Ali", size: "1.5L", price_cents: 600 }),
      web({ id: "w2", name: "Coke", name_fr: "Coca Cola", size: "33cl", price_cents: 700 }),
      web({ id: "w3", name: "Fanta", name_fr: "Fanta", size: "33cl", price_cents: 500 }),
      web({ id: "w4", name: "Divers", name_fr: "Divers" }),
      web({ id: "w5", name: "Coke no price", name_fr: "Coca Cola 33cl", price_cents: null }),
    ],
    apps
  );

  it("gives one row per web product, in order", () => {
    expect(rows.map((r) => r.webId)).toEqual(["w1", "w2", "w3", "w4", "w5"]);
  });

  it("matches on name and size, with prices in DH", () => {
    expect(rows[0]).toMatchObject({
      appProductId: "a-sidi15",
      appName: "SIDI ALI PET 1.50L",
      sheetPrice: "6.00",
      appPrice: "6.00",
      priceDiffers: false,
    });
  });

  it("flags a price difference only when both prices are known", () => {
    expect(rows[1].appProductId).toBe("a-coca");
    expect(rows[1].priceDiffers).toBe(true);
    expect(rows[1].sheetPrice).toBe("7.00");
    expect(rows[1].appPrice).toBe("5.00");
  });

  it("ignores inactive and misc products", () => {
    expect(rows[2].appProductId).toBeNull();
    expect(rows[2].confidence).toBe("none");
    expect(rows[3].appProductId).toBeNull();
  });

  it("does not flag a missing sheet price", () => {
    expect(rows[4].sheetPrice).toBeNull();
    expect(rows[4].priceDiffers).toBe(false);
  });

  it("uses each app product only once", () => {
    expect(rows[1].appProductId).toBe("a-coca");
    expect(rows[4].appProductId).toBeNull();
  });

  it("summarizes", () => {
    const s = summarizeMatchReport(rows);
    expect(s.total).toBe(5);
    expect(s.proposed + s.uncertain + s.none).toBe(5);
    expect(s.priceDiffers).toBe(1);
  });
});

describe("matchReportToCsv", () => {
  it("starts with a BOM and a French header", () => {
    const csv = matchReportToCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Produit web");
    expect(csv).toContain("Prix différent");
  });

  it("escapes quotes, commas and newlines", () => {
    const csv = matchReportToCsv([
      {
        webId: "w1",
        webName: 'Jus "Pom", orange\nfrais',
        size: null,
        sheetPrice: "7.50",
        appProductId: null,
        appName: null,
        appPrice: null,
        confidence: "none",
        priceDiffers: false,
      },
    ]);
    expect(csv).toContain('"Jus ""Pom"", orange\nfrais"');
    expect(csv).toContain(",aucun,non");
  });
});
