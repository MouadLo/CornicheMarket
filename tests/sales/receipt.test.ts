import type { PendingSale } from "../../src/lib/sales/offlineQueue";
import type { SaleLine, SaleSummary } from "../../src/lib/sales/queries";
import type { SaleReturnRecord } from "../../src/lib/sales/returns";
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
  updatedAfterReturn: "Updated after return",
  returnedOn: (date) => `Returned on ${date}`,
  originalTotal: "Original total",
  refunded: "Refunded",
  refundMethod: (method) => ({ cash: "cash", card: "card", credit: "credit" })[method],
  allReturned: "All items were returned",
  lineDiscount: (amount) => `Discount ${amount}`,
  loyaltyDiscount: "Loyalty discount",
  pointsEarned: (points) => `Points earned ${points}`,
  loyaltyBalance: (value, points) => `Balance ${value} (${points} points)`,
  loyaltyPending: "Points added when synced",
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
    const html = receiptToHtml(model, labels, opts).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
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

  it("boxes the shop name at the top, bigger, with the cashier below it, escaped", () => {
    const html = receiptToHtml(model(), labels, { ...opts, banner: '<b>Sara</b> & "Co"' });
    expect(html).toContain('<div class="cashier-tag">');
    expect(html).not.toContain("<b>Sara</b>");
    expect(html).toContain("&lt;b&gt;Sara&lt;/b&gt; &amp; &quot;Co&quot;");
    // shop name: the biggest text, in a box; the cashier under it, smaller
    expect(html).toContain("h1 { font-size: 24px; border: 3px solid #000;");
    expect(html).toContain(".cashier-tag { font-size: 16px");
    expect(html.indexOf("<h1>")).toBeLessThan(html.indexOf('class="cashier-tag"'));
    expect(html.indexOf('class="cashier-tag"')).toBeLessThan(html.indexOf('class="meta"'));
    expect(html).toContain(`${labels.cashier}: `);
    expect(html).toContain("\u2068");
  });

  it("does not repeat the cashier when the tag already names them", () => {
    const m = { ...model(), cashierName: "Mouad" };
    const withTag = receiptToHtml(m, labels, { ...opts, banner: " mouad " });
    expect(withTag).toContain('<div class="cashier-tag">');
    // said once, in the tag under the shop name, not again in the details
    expect(withTag.match(new RegExp(`${labels.cashier}:`, "g"))).toHaveLength(1);
    // another cashier's tag, or no tag: the cashier line stays
    expect(
      receiptToHtml(m, labels, { ...opts, banner: "Sara" }).match(
        new RegExp(`${labels.cashier}:`, "g")
      )
    ).toHaveLength(2);
    expect(
      receiptToHtml(m, labels, opts).match(new RegExp(`${labels.cashier}:`, "g"))
    ).toHaveLength(1);
  });

  it("leaves the output unchanged without a banner or paper option", () => {
    const plain = receiptToHtml(model(), labels, opts);
    expect(plain).not.toContain("cashier-tag");
    expect(plain).not.toContain("80mm auto");
    expect(receiptToHtml(model(), labels, { ...opts, banner: "   " })).toBe(plain);
  });

  it("sizes the page for a thermal roll only when asked", () => {
    const html = receiptToHtml(model(), labels, { ...opts, paper: "80mm" });
    expect(html).toContain("@page { size: 80mm auto; margin: 0; }");
    // marked so printReceipt can fit the page to the receipt, in its own rule
    expect(html).toContain('data-paper="80mm"');
    expect(html).toContain('<style id="receipt-page">');
    // 70 mm of content inside the printer's 72 mm printable width, and no fixed
    // 80 mm box: if Chrome adds page margins the receipt must shrink to fit, not
    // run off the right edge of the paper.
    expect(html).toContain(".receipt { width: 70mm;");
    expect(html).not.toContain("body { width: 80mm");
    const plain = receiptToHtml(model(), labels, opts);
    expect(plain).toContain("@page { margin: 4mm; }");
    expect(plain).not.toContain("data-paper");
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

describe("receipt after item returns", () => {
  const ret = (
    id: string,
    method: "cash" | "card" | "credit",
    items: { saleItemId: string; quantity: number; refundCents: number }[],
    createdAt = "2026-11-17T12:00:00Z"
  ): SaleReturnRecord => ({
    id,
    saleId: "s",
    createdAt,
    reasonCode: "damaged",
    note: null,
    refundMethod: method,
    refundCents: items.reduce((sum, item) => sum + item.refundCents, 0),
    items,
  });
  const line = (
    id: string,
    name: string,
    quantity: number,
    unitPrice: number,
    discount: number,
    unit: string | null = "piece"
  ): SaleLine => ({
    id,
    sale_id: "s",
    product_name: name,
    unit,
    quantity,
    unit_price_cents: unitPrice,
    discount_cents: discount,
    line_total_cents: Math.round(quantity * unitPrice) - discount,
  });
  const build = (sale: Partial<SaleSummary>, lines: SaleLine[], returns: SaleReturnRecord[]) =>
    receiptFromHistorySale(historySale(sale), lines, "Unknown", returns)!;

  it("is unchanged with no returns", () => {
    const plain = receiptFromHistorySale(historySale(), historyLines, "Unknown");
    expect(receiptFromHistorySale(historySale(), historyLines, "Unknown", [])).toEqual(plain);
    expect(plain?.afterReturns ?? null).toBeNull();
  });

  it("keeps the rest of a partly returned line (3 x 7, one returned)", () => {
    const model = build(
      { total_cents: 2100, discount_cents: 0 },
      [line("a", "Milk", 3, 700, 0)],
      [ret("r1", "cash", [{ saleItemId: "a", quantity: 1, refundCents: 700 }])]
    );
    expect(model.lines).toHaveLength(1);
    expect(model.lines[0]).toMatchObject({
      quantity: 2,
      unitPriceCents: 700,
      discountCents: 0,
      totalCents: 1400,
    });
    expect(model.totalCents).toBe(1400);
    expect(model.subtotalCents).toBe(1400);
    expect(model.discountCents).toBe(0);
    expect(model.afterReturns).toEqual({
      originalTotalCents: 2100,
      refundedCents: 700,
      refundMethods: ["cash"],
      lastReturnAt: "2026-11-17T12:00:00Z",
    });
  });

  it("drops a line returned in full", () => {
    const model = build(
      { total_cents: 1500, discount_cents: 0 },
      [line("a", "Milk", 1, 1000, 0), line("b", "Tea", 1, 500, 0)],
      [ret("r1", "cash", [{ saleItemId: "a", quantity: 1, refundCents: 1000 }])]
    );
    expect(model.lines.map((l) => l.name)).toEqual(["Tea"]);
    expect(model.totalCents).toBe(500);
  });

  it("adds up exactly with a sale-level discount", () => {
    // 2 x 5.00 and 1 x 10.00, 2.00 off the sale: each line paid 9.00.
    const lines = [line("a", "A", 2, 500, 0), line("b", "B", 1, 1000, 0)];
    const sale = { total_cents: 1800, discount_cents: 200 };

    const part = build(sale, lines, [
      ret("r1", "cash", [{ saleItemId: "a", quantity: 1, refundCents: 450 }]),
    ]);
    expect(part.totalCents).toBe(1350);
    // The kept unit shows its own price, not price + the refunded discount share.
    expect(part.lines[0]).toMatchObject({ quantity: 1, totalCents: 500, discountCents: 0 });
    expect(part.subtotalCents).toBe(1500);
    expect(part.discountCents).toBe(150);
    expect(part.subtotalCents - part.discountCents).toBe(part.totalCents);

    const full = build(sale, lines, [
      ret("r1", "cash", [{ saleItemId: "a", quantity: 2, refundCents: 900 }]),
    ]);
    expect(full.lines.map((l) => l.name)).toEqual(["B"]);
    expect(full.totalCents).toBe(900);
    expect(full.subtotalCents).toBe(1000);
    expect(full.discountCents).toBe(100);
    expect(full.subtotalCents - full.discountCents).toBe(full.totalCents);
  });

  it("never prints a negative discount when rounding leaves the lines short", () => {
    // A refund smaller than the kept share would leave the lines below the new
    // total: the largest kept line takes the difference.
    const model = build(
      { total_cents: 1000, discount_cents: 100 },
      [line("a", "A", 2, 550, 0)],
      [ret("r1", "cash", [{ saleItemId: "a", quantity: 1, refundCents: 400 }])]
    );
    expect(model.totalCents).toBe(600);
    expect(model.discountCents).toBe(0);
    expect(model.lines[0].totalCents).toBe(600);
    expect(model.subtotalCents).toBe(600);
  });

  it("shows the line discount that remains on a kept quantity", () => {
    // 3 x 7.00 with 1.00 line discount: paid 20.00; one returned refunds 6.67.
    const model = build(
      { total_cents: 2000, discount_cents: 0 },
      [line("a", "Milk", 3, 700, 100)],
      [ret("r1", "cash", [{ saleItemId: "a", quantity: 1, refundCents: 667 }])]
    );
    expect(model.lines[0]).toMatchObject({ quantity: 2, totalCents: 1333, discountCents: 67 });
    expect(model.totalCents).toBe(1333);
  });

  it("handles a weighed product (1.250 kg, 0.500 returned)", () => {
    const model = build(
      { total_cents: 1000, discount_cents: 0 },
      [line("a", "Cheese", 1.25, 800, 0, "kg")],
      [ret("r1", "card", [{ saleItemId: "a", quantity: 0.5, refundCents: 400 }])]
    );
    expect(model.lines[0]).toMatchObject({ quantity: 0.75, totalCents: 600, discountCents: 0 });
    expect(model.totalCents).toBe(600);
  });

  it("accumulates several returns, with distinct refund methods in order", () => {
    const model = build(
      { total_cents: 3000, discount_cents: 0 },
      [line("a", "Milk", 3, 1000, 0)],
      [
        ret(
          "r1",
          "card",
          [{ saleItemId: "a", quantity: 1, refundCents: 1000 }],
          "2026-11-17T11:00:00Z"
        ),
        ret(
          "r2",
          "cash",
          [{ saleItemId: "a", quantity: 0.5, refundCents: 500 }],
          "2026-11-17T13:00:00Z"
        ),
        ret(
          "r3",
          "card",
          [{ saleItemId: "a", quantity: 0.5, refundCents: 500 }],
          "2026-11-17T12:00:00Z"
        ),
      ]
    );
    expect(model.lines[0]).toMatchObject({ quantity: 1, totalCents: 1000 });
    expect(model.totalCents).toBe(1000);
    expect(model.afterReturns).toMatchObject({
      originalTotalCents: 3000,
      refundedCents: 2000,
      refundMethods: ["card", "cash"],
      lastReturnAt: "2026-11-17T13:00:00Z",
    });
  });

  it("has no lines and a zero total when everything is returned", () => {
    const model = build(
      { total_cents: 1000, discount_cents: 0 },
      [line("a", "Milk", 1, 1000, 0)],
      [ret("r1", "credit", [{ saleItemId: "a", quantity: 1, refundCents: 1000 }])]
    );
    expect(model.lines).toEqual([]);
    expect(model.totalCents).toBe(0);
    expect(model.subtotalCents).toBe(0);
    expect(model.discountCents).toBe(0);
    expect(receiptToText(model, labels, opts)).toContain("All items were returned");
    expect(receiptToHtml(model, labels, opts)).toContain("All items were returned");
  });

  it("ignores a returned item whose line is not on the sale", () => {
    const model = build(
      { total_cents: 1000, discount_cents: 0 },
      [line("a", "Milk", 1, 1000, 0)],
      [ret("r1", "cash", [{ saleItemId: "ghost", quantity: 1, refundCents: 0 }])]
    );
    expect(model.lines).toHaveLength(1);
    expect(model.lines[0].totalCents).toBe(1000);
    expect(model.totalCents).toBe(1000);
  });

  it("renders the update note, return date, original total and refund in html and text", () => {
    const model = build(
      { total_cents: 2100, discount_cents: 0 },
      [line("a", "Milk <b>", 3, 700, 0)],
      [
        ret("r1", "cash", [{ saleItemId: "a", quantity: 1, refundCents: 700 }]),
        ret("r2", "credit", [{ saleItemId: "a", quantity: 0.5, refundCents: 350 }]),
      ]
    );
    const html = receiptToHtml(model, labels, opts);
    expect(html).toContain("Updated after return");
    expect(html).toContain("Returned on");
    expect(html).toContain("Original total");
    expect(html).toContain("21.00 DH");
    expect(html).toContain("Refunded (cash / credit)");
    expect(html).toContain("-10.50 DH");
    expect(html).not.toContain("<b>");
    const text = receiptToText(model, labels, opts);
    expect(text).toContain("Updated after return");
    expect(text).toContain("Original total: 21.00 DH");
    expect(text).toContain("Refunded (cash / credit): -10.50 DH");
    expect(text).toContain("Total: 10.50 DH");
    // A plain receipt shows none of it.
    const plain = receiptToText(
      receiptFromHistorySale(historySale(), historyLines, "U")!,
      labels,
      opts
    );
    expect(plain).not.toContain("Original total");
  });
});
