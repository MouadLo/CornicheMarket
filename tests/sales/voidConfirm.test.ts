import { voidSaleConfirmMessage } from "../../src/lib/sales/voidConfirm";

describe("voidSaleConfirmMessage", () => {
  it("states the sale amount that will be reversed", () => {
    const t = (key: string, options?: Record<string, unknown>) =>
      `${key}:${JSON.stringify(options)}`;
    expect(voidSaleConfirmMessage(1450, t)).toBe('sell.voidConfirmMessage:{"amount":"14.50 DH"}');
  });
});
