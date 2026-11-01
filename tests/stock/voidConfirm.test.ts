import { voidDeliveryConfirmMessage } from "../../src/lib/stock/voidConfirm";
import { formatMAD } from "../../src/lib/money";
import { isolateBidi } from "../../src/lib/text/bidi";

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;

const line = (n: number, over = {}) => ({
  productId: `p${n}`,
  productName: `Produit ${n}`,
  unit: "piece",
  quantity: 24,
  unitCostCents: 600,
  stockBefore: 40,
  stockAfter: 16,
  costBeforeCents: 555,
  costAfterCents: 488,
  ...over,
});

describe("voidDeliveryConfirmMessage", () => {
  it("states, per product, the stock and average cost before and after", () => {
    const message = voidDeliveryConfirmMessage([line(1)], t, formatMAD);

    expect(message).toContain(
      `stockIn.deliveryVoidConfirmLine:${JSON.stringify({
        product: isolateBidi("Produit 1"),
        before: 40,
        after: 16,
        unit: "piece",
        costBefore: "5.55 DH",
        costAfter: "4.88 DH",
      })}`
    );
  });

  it("always says that past sales keep their cost", () => {
    expect(voidDeliveryConfirmMessage([line(1)], t, formatMAD)).toContain(
      "stockIn.deliveryVoidConfirmNotice"
    );
  });

  it("warns when a product would go below zero", () => {
    const message = voidDeliveryConfirmMessage([line(1, { stockAfter: -5 })], t, formatMAD);
    expect(message).toContain("stockIn.deliveryVoidConfirmNegative");
  });

  it("does not warn when nothing goes below zero", () => {
    expect(voidDeliveryConfirmMessage([line(1)], t, formatMAD)).not.toContain(
      "stockIn.deliveryVoidConfirmNegative"
    );
  });

  it("lists at most 8 products and counts the rest", () => {
    const lines = Array.from({ length: 12 }, (_, i) => line(i + 1));
    const message = voidDeliveryConfirmMessage(lines, t, formatMAD);

    expect(message.match(/deliveryVoidConfirmLine/g)).toHaveLength(8);
    expect(message).toContain('stockIn.deliveryVoidConfirmMore:{"count":4}');
  });
});
