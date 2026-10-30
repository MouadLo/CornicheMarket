import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ContinuousScanner } from "../../src/components/sell/ContinuousScanner";
import { CartLineRow } from "../../src/components/sell/CartLineRow";
import { PaymentSheet } from "../../src/components/sell/PaymentSheet";
import SellLayout from "../../app/(app)/sell/_layout";
import { paymentMethodKey } from "../../src/lib/sales/paymentMethod";
import { isolateBidi } from "../../src/lib/text/bidi";
import { hardcodedTexts, keyEcho, pressableByText } from "./sellTestUtils";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => `⟦${key}⟧` }),
}));

let mockGranted = false;
jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [{ granted: mockGranted }, jest.fn()],
  CameraView: () => null,
}));

jest.mock("expo-router", () => {
  const Stack = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  Stack.Screen = () => null;
  return { Stack, router: { push: jest.fn() } };
});

let tree: ReactTestRenderer;
afterEach(() => act(() => tree?.unmount()));

const line = {
  product_id: "p1",
  name: "Courgettes",
  unit: "kg",
  quantity: 1,
  unit_price_cents: 900,
  discount_cents: 0,
  unit_cost_cents: null,
};

function sheet() {
  return (
    <PaymentSheet
      visible
      totalCents={800}
      customers={[{ id: "c1", name: "Fatima Zahra", phone: null }]}
      saving={false}
      error={null}
      onClose={() => {}}
      onConfirm={() => {}}
      onCreateCustomer={async () => null}
    />
  );
}

describe("no hardcoded English in the Sell flow", () => {
  it("cart line (weighed and piece): unit label and remove are translated", () => {
    act(() => {
      tree = create(<CartLineRow line={line} onChange={() => {}} onRemove={() => {}} />);
    });
    expect(hardcodedTexts(tree.root, [isolateBidi("Courgettes")])).toEqual([]);

    act(() =>
      tree.update(
        <CartLineRow line={{ ...line, unit: "piece" }} onChange={() => {}} onRemove={() => {}} />
      )
    );
    expect(hardcodedTexts(tree.root, [isolateBidi("Courgettes")])).toEqual([]);
  });

  it("payment sheet, cash tab", () => {
    act(() => {
      tree = create(sheet());
    });
    expect(hardcodedTexts(tree.root)).toEqual([]);
  });

  it("payment sheet, short payment", () => {
    act(() => {
      tree = create(sheet());
    });
    act(() => tree.root.findAllByProps({ keyboardType: "decimal-pad" })[0].props.onChangeText("5"));
    expect(hardcodedTexts(tree.root)).toEqual([]);
  });

  it("payment sheet, credit tab", () => {
    act(() => {
      tree = create(sheet());
    });
    act(() => pressableByText(tree.root, keyEcho("sell.payLater")).props.onPress());
    expect(hardcodedTexts(tree.root, ["Fatima Zahra"])).toEqual([]);
  });

  it("camera scanner, permission prompt and live view", () => {
    mockGranted = false;
    act(() => {
      tree = create(<ContinuousScanner visible onClose={() => {}} onScanned={async () => null} />);
    });
    expect(hardcodedTexts(tree.root)).toEqual([]);

    mockGranted = true;
    act(() =>
      tree.update(<ContinuousScanner visible onClose={() => {}} onScanned={async () => null} />)
    );
    expect(hardcodedTexts(tree.root)).toEqual([]);
  });

  it("stack titles for credit, history and stuck sales", () => {
    act(() => {
      tree = create(<SellLayout />);
    });
    const titles = tree.root
      .findAll((node) => node.props.name && node.props.options)
      .map((node) => node.props.options.title)
      .filter(Boolean);
    expect(titles).toHaveLength(3);
    for (const title of titles) expect(title).toContain("⟦");
  });
});

describe("paymentMethodKey: sale history no longer prints the raw method", () => {
  it("maps each method to a translation key", () => {
    expect(paymentMethodKey("cash")).toBe("sell.paymentCash");
    expect(paymentMethodKey("card")).toBe("sell.paymentCard");
    expect(paymentMethodKey("credit")).toBe("sell.historyPayLater");
  });
});
