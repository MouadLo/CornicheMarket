import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import InvoiceList from "../../app/(app)/stock-in/invoice/index";
import { listInvoiceDrafts } from "../../src/lib/stock/invoices";

let mockOwner = true;
jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void) => require("react").useEffect(effect, [effect]),
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { role: mockOwner ? "owner" : "cashier" } }),
}));
jest.mock("../../src/lib/stock/invoices", () => ({ listInvoiceDrafts: jest.fn() }));

afterEach(() => {
  mockOwner = true;
  jest.clearAllMocks();
});

it("renders status and warnings and opens a failed draft for retry", async () => {
  const draft = {
    id: "one",
    purchase_id: null,
    supplier_id: null,
    invoice_date: null,
    invoice_number: "INV-07",
    suppliers: null,
    flags: ["unreadable_lines" as const],
  };
  jest.mocked(listInvoiceDrafts).mockResolvedValue([
    { ...draft, status: "failed" },
    { ...draft, id: "two", status: "ready", purchase_id: "purchase" },
  ]);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<InvoiceList />);
  });
  const labels = tree.root.findAllByType(Text).map((node) => node.props.children);
  expect(labels).toEqual(
    expect.arrayContaining([
      "invoices.statusFailed",
      "invoices.statusApproved",
      "invoices.unreadable_lines",
    ])
  );
  act(() => tree.root.findAllByType(Pressable)[0].props.onPress());
  expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ params: { id: "one" } }));
  act(() => tree.unmount());
});

it("skips the invoice list query for a cashier", async () => {
  mockOwner = false;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<InvoiceList />);
  });
  expect(listInvoiceDrafts).not.toHaveBeenCalled();
  act(() => tree.unmount());
});
