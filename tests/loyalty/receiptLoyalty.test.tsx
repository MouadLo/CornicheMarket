import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ReceiptPanel } from "../../src/components/sell/ReceiptPanel";
import type { PendingSale } from "../../src/lib/sales/offlineQueue";
import type { SaleLine, SaleSummary } from "../../src/lib/sales/queries";
import {
  receiptFromHistorySale,
  receiptFromPendingSale,
  receiptToHtml,
  receiptToText,
  type ReceiptLabels,
  type ReceiptLoyalty,
  type ReceiptModel,
} from "../../src/lib/sales/receipt";
import { allTexts } from "../sales/sellTestUtils";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key}|${Object.values(options).join("|")}` : key,
    i18n: { language: "fr" },
  }),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u1", role: "cashier", full_name: "Sara" } }),
}));
jest.mock("../../src/lib/sales/printReceipt", () => ({
  canPrintReceipt: () => true,
  canShareReceipt: async () => false,
  printReceipt: jest.fn(),
  shareReceipt: jest.fn(),
}));
jest.mock("../../src/lib/print/queries", () => ({
  sendPrintJob: jest.fn(),
  fetchPrintJob: jest.fn(),
  requeuePrintJob: jest.fn(),
  isStationOnline: jest.fn(async () => true),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "11111111-1111-1111-1111-111111111111" }));

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
  refundMethod: (method) => method,
  allReturned: "All items were returned",
  lineDiscount: (amount) => `Discount ${amount}`,
  loyaltyDiscount: "Loyalty discount",
  pointsEarned: (points) => `Points earned ${points}`,
  loyaltyBalance: (value, points) => `Balance ${value} (${points} points)`,
  loyaltyPending: "Points added when synced",
  unit: (unit) => unit,
};
const opts = { language: "en", timeZone: "UTC" };

// 25.00 DH of goods, 2.00 DH taken off by the cashier, 10.00 DH paid in points.
const sale = (): PendingSale => ({
  id: "abcdef12-3456-7890-abcd-ef1234567890",
  customer_id: null,
  payment_method: "cash",
  discount_cents: 1200,
  total_cents: 1300,
  created_at: "2026-11-17T10:00:00.000Z",
  attempts: 0,
  lines: [
    {
      product_id: "p1",
      name: "Milk",
      unit: "piece",
      quantity: 5,
      unit_price_cents: 500,
      discount_cents: 0,
      unit_cost_cents: 300,
      discountable: true,
    },
  ],
});
const loyalty = (extra: Partial<ReceiptLoyalty> = {}): ReceiptLoyalty => ({
  discountCents: 1000,
  pointsEarned: 1,
  balanceAfterPoints: 252,
  balanceAfterValueCents: 2520,
  pending: false,
  ...extra,
});

describe("receipt with loyalty", () => {
  it("a sale without a member has no loyalty block and prints as before", () => {
    const model = receiptFromPendingSale(sale());
    expect(model).not.toHaveProperty("loyalty");
    const html = receiptToHtml(model, labels, opts);
    expect(html).not.toContain("Loyalty discount");
    expect(html).not.toContain("Points earned");
  });

  it("splits the discount into the cashier's part and the points part", () => {
    const model = receiptFromPendingSale(sale(), { loyalty: loyalty() });
    const html = receiptToHtml(model, labels, opts);
    expect(html).toContain("Subtotal");
    expect(html).toContain("-2.00 DH");
    expect(html).toContain("Loyalty discount");
    expect(html).toContain("-10.00 DH");
    // 2.00 + 10.00 = the 12.00 DH of the sale's discount: the full figure is never shown.
    expect(html).not.toContain("-12.00 DH");
    expect(model.discountCents).toBe(1200);
    expect(model.totalCents).toBe(1300);
    const text = receiptToText(model, labels, opts);
    expect(text).toContain("Discount: -2.00 DH");
    expect(text).toContain("Loyalty discount: -10.00 DH");
  });

  it("only points: no cashier discount line, just the loyalty one", () => {
    const only = { ...sale(), discount_cents: 1000, total_cents: 1500 };
    const text = receiptToText(receiptFromPendingSale(only, { loyalty: loyalty() }), labels, opts);
    expect(text).not.toContain("Discount:");
    expect(text).toContain("Loyalty discount: -10.00 DH");
  });

  it("says what was earned and the balance, dirhams first", () => {
    const model = receiptFromPendingSale(sale(), { loyalty: loyalty() });
    const html = receiptToHtml(model, labels, opts);
    expect(html).toContain("Points earned +1");
    expect(html).toContain("Balance 25.20 DH (252 points)");
    const text = receiptToText(model, labels, opts);
    expect(text).toContain("Points earned +1");
    expect(text).toContain("Balance 25.20 DH (252 points)");
  });

  it("a member attached offline: pending note, no balance", () => {
    const model = receiptFromPendingSale(sale(), {
      loyalty: loyalty({
        discountCents: 0,
        balanceAfterPoints: null,
        balanceAfterValueCents: null,
        pending: true,
      }),
    });
    const text = receiptToText(model, labels, opts);
    expect(text).toContain("Points added when synced");
    expect(text).not.toContain("Balance");
  });

  it("nothing earned and no balance known: no loyalty lines", () => {
    const model = receiptFromPendingSale(sale(), {
      loyalty: loyalty({
        pointsEarned: 0,
        balanceAfterPoints: null,
        balanceAfterValueCents: null,
      }),
    });
    const text = receiptToText(model, labels, opts);
    expect(text).not.toContain("Points earned");
    expect(text).not.toContain("Balance");
  });

  it("the points discount can never exceed the discount it is part of", () => {
    const model = receiptFromPendingSale(sale(), { loyalty: loyalty({ discountCents: 99999 }) });
    expect(model.loyalty?.discountCents).toBe(1200);
  });

  it("escapes and isolates in Arabic", () => {
    const model = receiptFromPendingSale(sale(), { loyalty: loyalty() });
    const html = receiptToHtml(model, labels, { language: "ar", timeZone: "UTC" });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("⁦-10.00 DH⁩");
    expect(html).toContain("⁦+1⁩");
    const escaped = receiptToHtml(
      receiptFromPendingSale(sale(), { loyalty: loyalty() }),
      { ...labels, loyaltyPending: "<b>x</b>", loyaltyDiscount: "<i>y</i>" },
      opts
    );
    expect(escaped).toContain("&lt;i&gt;y&lt;/i&gt;");
    expect(escaped).not.toContain("<i>y</i>");
  });
});

describe("history receipt", () => {
  const summary = (extra: Partial<SaleSummary> = {}): SaleSummary => ({
    id: "0a1b2c3d-0000-0000-0000-000000000000",
    created_at: "2026-11-17T09:00:00Z",
    occurred_at: "2026-11-17T10:00:00Z",
    payment_method: "cash",
    total_cents: 1300,
    discount_cents: 1200,
    customer_id: null,
    voided_at: null,
    void_reason: null,
    cashier_name: "Sara",
    ...extra,
  });
  const lines: SaleLine[] = [
    {
      id: "l1",
      sale_id: "x",
      product_name: "Milk",
      unit: "piece",
      quantity: 5,
      unit_price_cents: 500,
      discount_cents: 0,
      line_total_cents: 2500,
    },
  ];

  it("shows only the points discount; earned and balance are unknown there", () => {
    const model = receiptFromHistorySale(
      summary({ loyalty_discount_cents: 1000 }),
      lines,
      "?"
    ) as ReceiptModel;
    expect(model.loyalty).toEqual({
      discountCents: 1000,
      pointsEarned: null,
      balanceAfterPoints: null,
      balanceAfterValueCents: null,
      pending: false,
    });
    const text = receiptToText(model, labels, opts);
    expect(text).toContain("Discount: -2.00 DH");
    expect(text).toContain("Loyalty discount: -10.00 DH");
    expect(text).not.toContain("Points earned");
    expect(text).not.toContain("Balance");
    expect(text).not.toContain("synced");
  });

  it("no points discount, no loyalty block", () => {
    expect(receiptFromHistorySale(summary(), lines, "?")).not.toHaveProperty("loyalty");
    expect(
      receiptFromHistorySale(summary({ loyalty_discount_cents: 0 }), lines, "?")
    ).not.toHaveProperty("loyalty");
  });
});

describe("ReceiptPanel", () => {
  let tree: ReactTestRenderer;
  afterEach(() => act(() => tree?.unmount()));

  async function show(model: ReceiptModel) {
    await act(async () => {
      tree = create(<ReceiptPanel receipt={model} onClose={() => {}} />);
    });
  }

  it("lists the cashier discount and the points discount apart, then earned and balance", async () => {
    await show(receiptFromPendingSale(sale(), { loyalty: loyalty() }));
    const texts = allTexts(tree.root);
    expect(texts).toContain("receipt.discount");
    expect(texts).toContain("-2.00 DH");
    expect(texts).toContain("receipt.loyaltyDiscount");
    expect(texts).toContain("-10.00 DH");
    const lines = tree.root
      .findAllByProps({ testID: "receipt-loyalty-line" })
      .filter((node) => typeof node.type === "string" || node.props.children !== undefined)
      .map((node) => [node.props.children].flat().join(""));
    expect(lines.some((l) => l.startsWith("receipt.pointsEarned|"))).toBe(true);
    expect(lines.some((l) => l.startsWith("receipt.loyaltyBalance|"))).toBe(true);
    expect(lines.join(" ")).toContain("25.20 DH");
    expect(lines.join(" ")).toContain("252");
  });

  it("pending member: the sync note", async () => {
    await show(
      receiptFromPendingSale(sale(), {
        loyalty: loyalty({
          discountCents: 0,
          balanceAfterPoints: null,
          balanceAfterValueCents: null,
          pending: true,
        }),
      })
    );
    expect(allTexts(tree.root)).toContain("receipt.loyaltyPending");
  });
});
