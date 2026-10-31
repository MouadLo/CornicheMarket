/**
 * The delivery screen is where a wrong delivery is voided: owner only, a
 * reason is required, and nothing is written until the owner has seen what
 * the void will do to stock and average cost and confirmed it.
 */
import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import DeliveryDetail from "../../app/(app)/stock-in/delivery/[id]";
import { BigButton } from "../../src/components/BigButton";
import { pressableByText, textOf } from "../sales/sellTestUtils";

let mockRole = "owner";
const mockFetchPurchase = jest.fn();
const mockPreview = jest.fn();
const mockVoid = jest.fn(async (..._args: unknown[]) => {});
const mockConfirm = jest.fn(async (..._args: unknown[]) => true);

// Stable t: the screen memoizes its load on it.
const mockT = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "p1" }),
  router: { push: jest.fn(), back: jest.fn() },
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u1", role: mockRole } }),
}));
jest.mock("../../src/lib/stock/queries", () => ({
  fetchPurchase: (...args: unknown[]) => mockFetchPurchase(...args),
  previewVoidPurchase: (...args: unknown[]) => mockPreview(...args),
  voidPurchase: (...args: unknown[]) => mockVoid(...args),
}));
jest.mock("../../src/lib/confirmDestructive", () => ({
  confirmDestructive: (...args: unknown[]) => mockConfirm(...args),
}));

const purchase = (over = {}) => ({
  id: "p1",
  purchaseDate: "2026-10-31T10:00:00Z",
  notes: "BL 12",
  supplierName: "Atlas",
  voidedAt: null,
  voidReason: null,
  voidedByName: null,
  totalCents: 14400,
  lines: [
    {
      id: "i1",
      productName: "Coca-Cola 33cl",
      unit: "piece",
      quantity: 24,
      unitCostCents: 600,
      lineTotalCents: 14400,
      expiryDate: "2027-01-01",
    },
  ],
  ...over,
});
const previewRows = [
  {
    productId: "a",
    productName: "Coca-Cola 33cl",
    unit: "piece",
    quantity: 24,
    unitCostCents: 600,
    stockBefore: 40,
    stockAfter: 16,
    costBeforeCents: 555,
    costAfterCents: 488,
  },
];

let tree: ReactTestRenderer;
async function render() {
  await act(async () => {
    tree = create(<DeliveryDetail />);
  });
}
beforeEach(() => {
  mockRole = "owner";
  mockFetchPurchase.mockReset().mockResolvedValue(purchase());
  mockPreview.mockReset().mockResolvedValue(previewRows);
  mockVoid.mockClear();
  mockConfirm.mockClear().mockResolvedValue(true);
});
afterEach(() => act(() => tree.unmount()));

const reasonInput = () => tree.root.findByProps({ placeholder: "stockIn.deliveryVoidReason" });
const voidButton = () =>
  tree.root.findAllByType(BigButton).find((b) => b.props.label === "stockIn.deliveryVoidButton")!;
async function typeReason(value: string) {
  await act(async () => reasonInput().props.onChangeText(value));
}
async function pressVoid() {
  await act(async () => {
    voidButton().props.onPress();
  });
}

describe("delivery detail", () => {
  it("shows the supplier, notes and every line with its quantity, cost and total", async () => {
    await render();
    const text = textOf(tree.root);
    expect(text).toContain("Atlas");
    expect(text).toContain("BL 12");
    expect(text).toContain("Coca-Cola 33cl");
    expect(text).toContain("144.00 DH");
  });

  it("owner only: a cashier sees a refusal and nothing is fetched", async () => {
    mockRole = "cashier";
    await render();
    expect(textOf(tree.root)).toContain("stockIn.deliveryOwnerOnly");
    expect(mockFetchPurchase).not.toHaveBeenCalled();
  });
});

describe("voiding", () => {
  it("cannot be pressed without a reason, nor with a blank one", async () => {
    await render();
    expect(voidButton().props.disabled).toBe(true);

    await typeReason("   ");
    expect(voidButton().props.disabled).toBe(true);

    await typeReason("typo");
    expect(voidButton().props.disabled).toBe(false);
  });

  it("shows the preview in the confirmation and voids with the trimmed reason after a yes", async () => {
    await render();
    await typeReason("  quantity typo ");
    await pressVoid();

    expect(mockPreview).toHaveBeenCalledWith("p1");
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    const [title, message, confirmLabel, cancelLabel] = mockConfirm.mock.calls[0] as string[];
    expect(title).toBe("stockIn.deliveryVoidConfirmTitle");
    expect(message).toContain("stockIn.deliveryVoidConfirmLine");
    expect(message).toContain("5.55 DH");
    expect(message).toContain("4.88 DH");
    expect(confirmLabel).toBe("stockIn.deliveryVoidButton");
    expect(cancelLabel).toBe("common.cancel");
    expect(mockVoid).toHaveBeenCalledWith("p1", "quantity typo");
  });

  it("writes nothing when the confirmation is declined", async () => {
    mockConfirm.mockResolvedValue(false);
    await render();
    await typeReason("typo");
    await pressVoid();

    expect(mockVoid).not.toHaveBeenCalled();
  });

  it("writes nothing if the preview itself fails", async () => {
    mockPreview.mockRejectedValue(new Error("boom"));
    await render();
    await typeReason("typo");
    await pressVoid();

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockVoid).not.toHaveBeenCalled();
    expect(textOf(tree.root)).toContain("boom");
  });

  it("reloads the delivery after voiding and shows the server's refusal if it fails", async () => {
    await render();
    await typeReason("typo");
    await pressVoid();
    expect(mockFetchPurchase).toHaveBeenCalledTimes(2);

    mockVoid.mockRejectedValueOnce(new Error("Only the owner can void a delivery"));
    await pressVoid();
    expect(textOf(tree.root)).toContain("Only the owner can void a delivery");
  });

  it("a second tap while the first void is in flight sends nothing", async () => {
    let finish: () => void = () => {};
    mockVoid.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
    await render();
    await typeReason("typo");

    const onPress = voidButton().props.onPress;
    await act(async () => {
      onPress();
      onPress();
    });
    await act(async () => finish());

    expect(mockVoid).toHaveBeenCalledTimes(1);
  });
});

describe("an already voided delivery", () => {
  beforeEach(() => {
    mockFetchPurchase.mockResolvedValue(
      purchase({
        voidedAt: "2026-10-31T12:00:00Z",
        voidReason: "wrong invoice",
        voidedByName: "Mouad",
      })
    );
  });

  it("shows who, when and why, and offers no way to void it again", async () => {
    await render();
    const texts = tree.root.findAllByType(Text).map((n) => textOf(n));
    expect(texts.join(" ")).toContain("stockIn.deliveryVoidedBanner");
    expect(texts.join(" ")).toContain("wrong invoice");
    expect(tree.root.findAllByProps({ placeholder: "stockIn.deliveryVoidReason" })).toHaveLength(0);
    expect(
      tree.root
        .findAllByType(BigButton)
        .filter((b) => b.props.label === "stockIn.deliveryVoidButton")
    ).toHaveLength(0);
  });
});
