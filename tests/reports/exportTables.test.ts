import i18next from "i18next";

import ar from "../../src/i18n/ar";
import en from "../../src/i18n/en";
import fr from "../../src/i18n/fr";
import { neutralizeFormula, tablesToCsv, tablesToHtml } from "../../src/lib/reports/export";
import { buildReportTables, type ReportExportData } from "../../src/lib/reports/exportTables";

import { saveTextFile } from "../../src/lib/files";

const mockWrite = jest.fn();
jest.mock("expo-file-system", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: (...args: unknown[]) => mockWrite(...args),
}));
jest.mock("expo-sharing", () => ({ isAvailableAsync: async () => false, shareAsync: jest.fn() }));
jest.mock("expo-document-picker", () => ({}));
jest.mock("expo-print", () => ({}));

const langs = { fr, en, ar } as const;
type Lang = keyof typeof langs;

function translator(lang: Lang) {
  const i = i18next.createInstance();
  void i.init({
    lng: lang,
    resources: { [lang]: { translation: langs[lang] } },
    interpolation: { escapeValue: false },
    initImmediate: false,
  } as never);
  return { t: i.t.bind(i) as (k: string, o?: Record<string, unknown>) => string, i };
}

const data = (language: string): ReportExportData => ({
  rangeLabel: "R",
  summary: {
    revenue_cents: 123456,
    cogs_cents: 100000,
    gross_profit_cents: -5,
    margin_percent: 12.5,
    transaction_count: 7,
    average_basket_cents: 1750,
    loss_cents: 0,
  } as never,
  inventory: { cost_value_cents: 5000, retail_value_cents: 7000 } as never,
  daily: [{ day: "2026-11-01", revenue_cents: 1000, profit_cents: -250, transaction_count: 2 }],
  categories: [
    {
      category_id: null,
      category_name: "Uncategorised",
      quantity: 1,
      revenue_cents: 100,
      profit_cents: 10,
    },
    {
      category_id: "x",
      category_name: "Boissons",
      quantity: 3,
      revenue_cents: 300,
      profit_cents: 30,
    },
  ],
  topByProfit: [
    {
      product_id: "p",
      product_name: "=HYPERLINK(1)",
      unit: "piece",
      quantity: 2,
      revenue_cents: 500,
      profit_cents: -100,
      margin_percent: null,
    },
  ],
  topByQuantity: [],
  lowestMargin: [],
  deadStock: [
    {
      product_id: "p",
      product_name: "Lait, 1L",
      unit: "pack",
      stock_quantity: 4,
      stock_value_cents: 4000,
      last_sold_at: "2026-10-31T23:30:00Z",
    },
    {
      product_id: "q",
      product_name: "Thé",
      unit: "kg",
      stock_quantity: 2.5,
      stock_value_cents: 100,
      last_sold_at: null,
    },
  ],
  timeZone: "Africa/Casablanca",
  language,
});

describe("report tables follow the language", () => {
  it.each(["fr", "en", "ar"] as Lang[])("%s: every key resolves, no raw keys", (lang) => {
    const { t } = translator(lang);
    const tables = buildReportTables(data(lang), t);
    const text = JSON.stringify(tables);
    expect(text).not.toContain("reports.");
    expect(text).not.toContain("units.");
    expect(tables).toHaveLength(7);
  });

  it("headers differ per language and currency is in the column name", () => {
    const h = (l: Lang) => buildReportTables(data(l), translator(l).t)[1].columns;
    expect(h("en")).toEqual(["Day", "Revenue (DH)", "Profit (DH)", "Transactions"]);
    expect(h("fr")).toEqual(["Jour", "Chiffre d'affaires (DH)", "Bénéfice (DH)", "Transactions"]);
    expect(h("ar")[1]).toBe("الإيرادات (درهم)");
  });

  it("numbers are identical in every language", () => {
    const nums = (l: Lang) =>
      buildReportTables(data(l), translator(l).t).map((tb) =>
        tb.rows.map((r) =>
          r.filter((c) => typeof c === "number" || /^-?\d+(\.\d+)?$/.test(String(c)))
        )
      );
    expect(nums("fr")).toEqual(nums("en"));
    expect(nums("ar")).toEqual(nums("en"));
    const en = buildReportTables(data("en"), translator("en").t);
    expect(en[0].rows[0]).toEqual(["Revenue (DH)", "1234.56"]);
    expect(en[0].rows[2][1]).toBe("-0.05");
    expect(en[1].rows[0]).toEqual(["2026-11-01", "10.00", "-2.50", 2]);
  });

  it("localizes categories, units, fallbacks; dates are ISO in store time zone", () => {
    const ar_ = buildReportTables(data("ar"), translator("ar").t);
    expect(ar_[2].rows[0][0]).toBe("بدون فئة");
    expect(ar_[2].rows[1][0]).toBe("المشروبات");
    expect(ar_[6].rows[0][4]).toBe("2026-11-01");
    expect(ar_[6].rows[1][4]).toBe("لم يُباع قط");
    const fr_ = buildReportTables(data("fr"), translator("fr").t);
    expect(fr_[2].rows[0][0]).toBe("Sans catégorie");
    expect(fr_[6].rows[1][4]).toBe("jamais vendu");
  });
});

describe("csv text", () => {
  it("quotes commas, quotes and line breaks; has no BOM itself", () => {
    const csv = tablesToCsv([
      { title: 'T, "x"', columns: ["a"], rows: [["Lait, 1L"], ['say "hi"'], ["l1\nl2"]] },
    ]);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv).toContain('"T, ""x"""');
    expect(csv).toContain('"Lait, 1L"');
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"l1\nl2"');
  });

  it("neutralizes formulas but keeps real numbers", () => {
    expect(neutralizeFormula("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(neutralizeFormula("+1 foo")).toBe("'+1 foo");
    expect(neutralizeFormula("@x")).toBe("'@x");
    expect(neutralizeFormula("-cmd")).toBe("'-cmd");
    expect(neutralizeFormula("-12.50")).toBe("-12.50");
    expect(neutralizeFormula(-3)).toBe(-3);
    const csv = tablesToCsv(buildReportTables(data("en"), translator("en").t));
    expect(csv).toContain("'=HYPERLINK(1),2,5.00,-1.00,—");
    expect(csv).toContain("Gross profit (DH),-0.05");
  });
});

describe("BOM", () => {
  beforeEach(() => mockWrite.mockClear());
  it("is written exactly once, even if content already has one", async () => {
    const csv = tablesToCsv(buildReportTables(data("ar"), translator("ar").t));
    await saveTextFile("r.csv", csv);
    await saveTextFile("r2.csv", "﻿" + csv);
    for (const call of mockWrite.mock.calls) {
      const written = call[1] as string;
      expect(written.startsWith("﻿")).toBe(true);
      expect(written.slice(1).includes("﻿")).toBe(false);
    }
    expect(mockWrite).toHaveBeenCalledTimes(2);
  });
});

describe("pdf html", () => {
  it("is rtl and right aligned in Arabic, ltr in French", () => {
    const tables = buildReportTables(data("ar"), translator("ar").t);
    const ar_ = tablesToHtml("h", "s", tables, "ar");
    expect(ar_).toContain('<html lang="ar" dir="rtl">');
    expect(ar_).toContain("text-align: right");
    const fr_ = tablesToHtml("h", "s", tables, "fr");
    expect(fr_).toContain('<html lang="fr" dir="ltr">');
    expect(fr_).toContain("text-align: left");
  });
});
