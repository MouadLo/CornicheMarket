/**
 * C03 at the screen level: a failed or unanswered Save must be retried with
 * the SAME operation id, so the server can recognise the retry instead of
 * receiving the stock a second time. A new delivery gets a new id. A second
 * tap while the first save is in flight sends nothing.
 */
import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import StockInScreen from "../../app/(app)/stock-in/index";
import { BigButton } from "../../src/components/BigButton";
import { ProductSearchPicker } from "../../src/components/stock/ProductSearchPicker";
import { StockInLine } from "../../src/components/stock/StockInLine";

let mockUuidCounter = 0;
const mockReceiveDelivery = jest.fn();
const mockBatchUpdateSellingPrices = jest.fn();

jest.mock("expo-crypto", () => ({ randomUUID: () => `op-${++mockUuidCounter}` }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "owner-1", role: "owner" } }),
}));
jest.mock("../../src/lib/inventory/queries", () => ({
  fetchNegativeStockProducts: async () => [],
}));
jest.mock("../../src/lib/products/queries", () => ({
  batchUpdateSellingPrices: (...args: unknown[]) => mockBatchUpdateSellingPrices(...args),
}));
jest.mock("../../src/lib/stock/queries", () => {
  class ReceiveDeliveryError extends Error {
    readonly kind: string;
    constructor(message: string, errorKind: string) {
      super(message);
      this.kind = errorKind;
    }
  }
  return {
    ReceiveDeliveryError,
    fetchSuppliers: async () => [],
    createSupplier: jest.fn(),
    fetchLastPurchasePrice: async () => null,
    receiveDelivery: (...args: unknown[]) => mockReceiveDelivery(...args),
  };
});
jest.mock("../../src/components/stock/ProductSearchPicker", () => ({
  ProductSearchPicker: () => null,
}));
jest.mock("../../src/components/stock/StockInLine", () => ({ StockInLine: () => null }));

const milk = {
  id: "milk",
  name: "Milk 1L",
  barcode: "6111234567890",
  category_id: null,
  unit: "piece",
  selling_price_cents: 700,
  current_cost_cents: 500,
  stock_quantity: 4,
  low_stock_threshold: 2,
  is_low_stock: false,
  active: true,
};

let tree: ReactTestRenderer;

beforeEach(async () => {
  mockUuidCounter = 0;
  mockReceiveDelivery.mockReset();
  mockBatchUpdateSellingPrices.mockReset();
  await act(async () => {
    tree = create(<StockInScreen />);
  });
});
afterEach(() => act(() => tree.unmount()));

async function addLine(fields: { quantity: string; unitCost: string; expiryDate?: string; newSellingPriceCents?: number | null }) {
  await act(async () => {
    await tree.root.findByType(ProductSearchPicker).props.onPick(milk);
  });
  const lines = tree.root.findAllByType(StockInLine);
  const last = lines[lines.length - 1];
  act(() =>
    last.props.onChange({
      ...last.props.line,
      quantity: fields.quantity,
      unitCost: fields.unitCost,
      expiryDate: fields.expiryDate ?? "",
      newSellingPriceCents: fields.newSellingPriceCents ?? null,
    })
  );
}

const saveButton = () =>
  tree.root.findAllByType(BigButton).find((button) => button.props.label === "stockIn.recordDelivery")!;

async function pressSave() {
  await act(async () => {
    saveButton().props.onPress();
  });
}

const texts = () => tree.root.findAllByType(Text).map((node) => node.props.children);

describe("Stock In save", () => {
  it("sends the whole delivery, price changes included, in one receiveDelivery call", async () => {
    mockReceiveDelivery.mockResolvedValue("purchase-1");
    await addLine({ quantity: "10", unitCost: "6", expiryDate: "31/03/2026", newSellingPriceCents: 1200 });

    await pressSave();

    expect(mockReceiveDelivery).toHaveBeenCalledTimes(1);
    expect(mockReceiveDelivery).toHaveBeenCalledWith("op-1", {
      supplierId: null,
      notes: null,
      lines: [{ product_id: "milk", quantity: 10, unit_cost_cents: 600, expiry_date: "2026-03-31" }],
      priceUpdates: [{ product_id: "milk", selling_price_cents: 1200 }],
    });
    expect(mockBatchUpdateSellingPrices).not.toHaveBeenCalled();
  });

  it("retries a failed save with the same operation id", async () => {
    mockReceiveDelivery.mockRejectedValueOnce(new Error("Network request failed"));
    mockReceiveDelivery.mockResolvedValueOnce("purchase-1");
    await addLine({ quantity: "10", unitCost: "6" });

    await pressSave();
    await pressSave();

    expect(mockReceiveDelivery).toHaveBeenCalledTimes(2);
    expect(mockReceiveDelivery.mock.calls[0][0]).toBe("op-1");
    expect(mockReceiveDelivery.mock.calls[1][0]).toBe("op-1");
  });

  it("keeps the operation id when the draft is edited after a failure", async () => {
    mockReceiveDelivery.mockRejectedValueOnce(new Error("Network request failed"));
    mockReceiveDelivery.mockResolvedValueOnce("purchase-1");
    await addLine({ quantity: "10", unitCost: "6" });
    await pressSave();

    await addLine({ quantity: "2", unitCost: "3" });
    await pressSave();

    expect(mockReceiveDelivery.mock.calls[1][0]).toBe("op-1");
  });

  it("gives the next delivery a new operation id after a successful save", async () => {
    mockReceiveDelivery.mockResolvedValue("purchase-1");
    await addLine({ quantity: "10", unitCost: "6" });
    await pressSave();

    await addLine({ quantity: "5", unitCost: "6" });
    await pressSave();

    expect(mockReceiveDelivery.mock.calls[0][0]).toBe("op-1");
    expect(mockReceiveDelivery.mock.calls[1][0]).toBe("op-2");
  });

  it("a second tap while the first save is in flight sends nothing", async () => {
    let finish: (id: string) => void = () => {};
    mockReceiveDelivery.mockImplementation(() => new Promise<string>((resolve) => (finish = resolve)));
    await addLine({ quantity: "10", unitCost: "6" });

    const onPress = saveButton().props.onPress;
    await act(async () => {
      onPress();
      onPress();
    });
    await act(async () => finish("purchase-1"));

    expect(mockReceiveDelivery).toHaveBeenCalledTimes(1);
  });

  it("does not save a line whose expiry date does not exist", async () => {
    await addLine({ quantity: "5", unitCost: "5", expiryDate: "2026-02-31" });

    expect(saveButton().props.disabled).toBe(true);
    expect(texts()).toContain("stockIn.incomplete");
  });

  it("explains when the server says this delivery was already saved", async () => {
    const { ReceiveDeliveryError } = jest.requireMock("../../src/lib/stock/queries");
    mockReceiveDelivery.mockRejectedValue(new ReceiveDeliveryError("dup", "already_saved"));
    await addLine({ quantity: "10", unitCost: "6" });

    await pressSave();

    expect(texts()).toContain("stockIn.alreadySaved");
  });
});
