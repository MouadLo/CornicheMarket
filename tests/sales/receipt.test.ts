import type { PendingSale } from "../../src/lib/sales/offlineQueue";
import type { SaleLine, SaleSummary } from "../../src/lib/sales/queries";
import {
  canOfferReceipt,
  escapeHtml,
  formatReceiptQuantity,
  receiptFromHistorySale,
  receiptFromPendingSale,
  receiptNumberOf,
  receiptToHtml,
  receiptToText,
  type ReceiptLabels,
} from "../../src/lib/sales/receipt";

const labels: ReceiptLabels = {
  receipt: "Receipt",
  number: "Receipt no.",
  cashier: "Cashier",
  customer: "Customer",
  subtotal: "Subtotal",
  discount: "Discount",
  total: "Total",
  payment: "Payment",
  paymentMethod: "Cash",
  cashReceived: "Cash received",
  change: "Change",
  thanks: "Thank you!",
  lineDiscount: (amount) => `Discount ${amount}`,
  unit: (unit, quantity) => `${unit}${quantity === 1 ? "" : "s"}`,
};

const pending = (extra: Partial<PendingSale> = {}): PendingSale => ({
  id: "abcdef12-3456-7890-abcd-ef1234567890",
  customer_id: null,
  payment_method: "cash",
  discount_cents: 100,
  total_cents: 2150,
  created_at: "2026-11-17T10:00:00.000Z",
  attempts: 0,
  lines: [
    {
      product_id: "p1",
      name: "Milk",
      unit: "piece",
      quantity: 3,
      unit_price_cents: 700,
      discount_cents: 50,
      unit_cost_cents: 420,
      discountable: true,
    },
    {
      product_id: "p2",
      name: "Cheese",
      unit: "kg",
      quantity: 0.25,
      unit_price_cents: 400,
      discount_cents: 0,
      unit_cost_cents: 250,
      discountable: true,
    },
  ],
  ...extra,
});

const historySale = (extra: Partial<SaleSummary> = {}): SaleSummary => ({
  id: "0a1b2c3d-0000-0000-0000-000000000000",
  created_at: "2026-11-17T09:00:00Z",
  occurred_at: "2026-11-17T10:00:00Z",
  payment_method: "cash",
  total_cents: 1150,
  discount_cents: 100,
  customer_id: null,
  voided_at: null,
  void_reason: null,
  cashier_name: "Sara",
  ...extra,
});
const historyLines: SaleLine[] = [
  {
    id: "l1",
    sale_id: "x",
    product_name: "Huile",
    unit: "piece",
    quantity: 2,
    unit_price_cents: 600,
    discount_cents: 50,
    line_total_cents: 1150,
  },
  {
    id: "l2",
    sale_id: "x",
    product_name: null,
    unit: null,
    quantity: 1,
    unit_price_cents: 100,
    discount_cents: 0,
    line_total_cents: 100,
  },
];

const opts = { language: "en", timeZone: "UTC" };

describe("receipt model", () => {
  it("numbers the receipt with the first 8 characters of the sale id, uppercase", () => {
    expect(receiptNumberOf("abcdef12-3456")).toBe("ABCDEF12");
  });

  it("builds totals and line amounts from a just-completed sale", () => {
    const model = receiptFromPendingSale(pending());
    expect(model.receiptNumber).toBe("ABCDEF12");
    expect(model.totalCents).toBe(2150);
    expect(model.discountCents).toBe(100);
    expect(model.subtotalCents).toBe(2250);
    expect(model.lines.map((l) => l.totalCents)).toEqual([2050, 100]);
    expect(model.lines[0]).toMatchObject({ quantity: 3, unitPriceCents: 700, discountCents: 50 });
  });

  it("uses the stored totals and line totals for a history sale", () => {
    const model = receiptFromHistorySale(historySale(), historyLines, "Unknown");
    expect(model).not.toBeNull();
    expect(model!.totalCents).toBe(1150);
    expect(model!.discountCents).toBe(100);
    expect(model!.subtotalCents).toBe(1250);
    expect(model!.lines.map((l) => l.totalCents)).toEqual([1150, 100]);
    expect(model!.lines[1].name).toBe("Unknown");
    expect(model!.occurredAt).toBe("2026-11-17T10:00:00Z");
    expect(model!.cashierName).toBe("Sara");
  });

  it("carries no cost, margin or profit anywhere", () => {
    const model = receiptFromPendingSale(pending(), { cashierName: "Sara" });
    const json = JSON.stringify(model);
    expect(json).not.toMatch(/cost|margin|profit/i);
    expect(json).not.toContain("420");
    // The stylesheet legitimately says "margin"; check the visible markup.
    const html = receiptToHtml(model, labels, opts).replace(/<style>[\s\S]*?<\/style>/, "");
    const text = receiptToText(model, labels, opts);
    expect(html).not.toMatch(/cost|margin|profit/i);
    expect(text).not.toMatch(/cost|margin|profit/i);
    expect(html).not.toMatch(/(^|\D)4\.20 DH/);
    expect(html).not.toMatch(/(^|\D)2\.50 DH/);
  });

  it("shows cash received and change only when known", () => {
    const known = receiptFromPendingSale(pending(), {
      cashReceivedCents: 2500,
      changeCents: 350,
    });
    expect(known.cashReceivedCents).toBe(2500);
    expect(known.changeCents).toBe(350);
    const html = receiptToHtml(known, labels, opts);
    expect(html).toContain("Cash received");
    expect(html).toContain("25.00 DH");
    expect(html).toContain("3.50 DH");

    const unknown = receiptFromPendingSale(pending());
    expect(unknown.cashReceivedCents).toBeNull();
    expect(receiptToHtml(unknown, labels, opts)).not.toContain("Cash received");

    const fromHistory = receiptFromHistorySale(historySale(), historyLines, "?")!;
    expect(fromHistory.cashReceivedCents).toBeNull();
    expect(fromHistory.changeCents).toBeNull();
    const historyHtml = receiptToHtml(fromHistory, labels, opts);
    expect(historyHtml).not.toContain("Cash received");
    expect(historyHtml).not.toContain("Change");
    expect(receiptToText(fromHistory, labels, opts)).not.toContain("Change");
  });

  it("never shows change on a card or credit sale", () => {
    const model = receiptFromPendingSale(pending({ payment_method: "card" }), {
      cashReceivedCents: 3000,
      changeCents: 850,
    });
    expect(model.cashReceivedCents).toBeNull();
    expect(model.changeCents).toBeNull();
  });

  it("names the customer on credit sales only", () => {
    const credit = receiptFromPendingSale(pending({ payment_method: "credit" }), {
      customerName: "Hassan",
    });
    expect(credit.customerName).toBe("Hassan");
    expect(receiptToHtml(credit, labels, opts)).toContain("Customer");
    const cash = receiptFromPendingSale(pending(), { customerName: "Hassan" });
    expect(cash.customerName).toBeNull();
  });

  it("offers no receipt for a voided sale", () => {
    const voided = historySale({ voided_at: "2026-11-17T11:00:00Z" });
    expect(canOfferReceipt(voided)).toBe(false);
    expect(receiptFromHistorySale(voided, historyLines, "?")).toBeNull();
    expect(canOfferReceipt(historySale())).toBe(true);
  });
});

describe("receipt html", () => {
  it("escapes every dynamic value", () => {
    const evil = '<script>alert("x")</script> & Co';
    const model = receiptFromPendingSale(
      pending({
        payment_method: "credit",
        lines: [
          {
            product_id: "p",
            name: evil,
            unit: "piece",
            quantity: 1,
            unit_price_cents: 100,
            discount_cents: 0,
            unit_cost_cents: null,
            discountable: true,
          },
        ],
      }),
      { cashierName: evil, customerName: evil }
    );
    const html = receiptToHtml(model, labels, opts);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; Co");
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;"
    );
  });

  it("shows the date without seconds, the lines, the totals and the thank-you", () => {
    const html = receiptToHtml(receiptFromPendingSale(pending()), labels, opts);
    expect(html).toContain("Corniche Market");
    expect(html).toContain("17/11/2026, 10:00");
    expect(html).toContain("ABCDEF12");
    expect(html).toContain("3 pieces");
    expect(html).toContain("7.00 DH");
    expect(html).toContain("Discount 0.50 DH");
    expect(html).toContain("22.50 DH");
    expect(html).toContain("21.50 DH");
    expect(html).toContain("Thank you!");
    expect(html).toContain("@page");
    expect(html).toContain("72mm");
  });

  it("omits subtotal and discount rows when there is no discount", () => {
    const model = receiptFromPendingSale(pending({ discount_cents: 0, total_cents: 2250 }));
    const html = receiptToHtml(model, labels, opts);
    expect(html).not.toContain("Subtotal");
    expect(html).not.toContain(">Discount<");
  });

  it("uses right-to-left for Arabic and keeps amounts left to right", () => {
    const html = receiptToHtml(receiptFromPendingSale(pending()), labels, {
      language: "ar",
      timeZone: "UTC",
    });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain("\u{2066}21.50 DH\u{2069}");
    expect(html).toContain("\u{2066}ABCDEF12\u{2069}");
    const english = receiptToHtml(receiptFromPendingSale(pending()), labels, opts);
    expect(english).toContain('dir="ltr"');
    expect(english).not.toContain("\u{2066}");
  });
});

describe("receipt html banner and paper", () => {
  const model = () => receiptFromPendingSale(pending());

  it("prints the cashier banner at the top, escaped", () => {
    const html = receiptToHtml(model(), labels, { ...opts, banner: '<b>Sara</b> & "Co"' });
    expect(html).toContain('<div class="banner">');
    expect(html).not.toContain("<b>Sara</b>");
    expect(html).toContain("&lt;b&gt;Sara&lt;/b&gt; &amp; &quot;Co&quot;");
    expect(html).toContain("font-size: 22px");
    expect(html.indexOf('class="banner"')).toBeLessThan(html.indexOf("<h1>"));
    expect(html).toContain("\u2068");
  });

  it("leaves the output unchanged without a banner or paper option", () => {
    const plain = receiptToHtml(model(), labels, opts);
    expect(plain).not.toContain("banner");
    expect(plain).not.toContain("80mm auto");
    expect(receiptToHtml(model(), labels, { ...opts, banner: "   " })).toBe(plain);
  });

  it("sizes the page for a thermal roll only when asked", () => {
    const html = receiptToHtml(model(), labels, { ...opts, paper: "80mm" });
    expect(html).toContain("@page { size: 80mm auto; margin: 4mm; }");
    expect(receiptToHtml(model(), labels, opts)).toContain("@page { margin: 4mm; }");
  });
});

describe("receipt text and quantities", () => {
  it("formats quantities to at most three decimals", () => {
    expect(formatReceiptQuantity(3)).toBe("3");
    expect(formatReceiptQuantity(0.25)).toBe("0.25");
    expect(formatReceiptQuantity(0.1 + 0.2)).toBe("0.3");
    expect(formatReceiptQuantity(1.2346)).toBe("1.235");
  });

  it("produces a plain-text version with the same amounts", () => {
    const text = receiptToText(receiptFromPendingSale(pending()), labels, opts);
    expect(text).toContain("Corniche Market");
    expect(text).toContain("Total: 21.50 DH");
    expect(text).toContain("Subtotal: 22.50 DH");
    expect(text).toContain("Thank you!");
  });
});
