import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import InvoiceList from "../../app/(app)/stock-in/invoice/index";
import { listInvoiceDrafts } from "../../src/lib/stock/invoices";
import { confirmAndDeleteInvoiceDraft } from "../../src/lib/stock/deleteInvoiceDraftFlow";

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
jest.mock("../../src/lib/stock/deleteInvoiceDraftFlow", () => ({
  confirmAndDeleteInvoiceDraft: jest.fn(),
}));

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

it("offers delete only on unapproved drafts and removes the row once deleted", async () => {
  const draft = {
    id: "one",
    purchase_id: null,
    supplier_id: null,
    invoice_date: null,
    invoice_number: "INV-07",
    suppliers: null,
    flags: [],
    status: "ready" as const,
  };
  jest
    .mocked(listInvoiceDrafts)
    .mockResolvedValue([draft, { ...draft, id: "two", purchase_id: "purchase" }]);
  jest.mocked(confirmAndDeleteInvoiceDraft).mockResolvedValue({ result: "deleted" });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<InvoiceList />);
  });
  const deletes = () =>
    tree.root.findAllByType(Pressable).filter((p) => {
      const children = p.findAllByType(Text).map((n) => n.props.children);
      return children.includes("invoices.deleteDraft");
    });
  expect(deletes()).toHaveLength(1);
  await act(async () => {
    await deletes()[0].props.onPress();
  });
  expect(confirmAndDeleteInvoiceDraft).toHaveBeenCalledWith(
    expect.objectContaining({ id: "one" }),
    expect.any(Function)
  );
  expect(deletes()).toHaveLength(0);
  expect(tree.root.findAllByType(Text).map((n) => n.props.children)).toContain(
    "invoices.statusApproved"
  );
  act(() => tree.unmount());
});

it("shows a refused delete inline and keeps the row", async () => {
  jest.mocked(listInvoiceDrafts).mockResolvedValue([
    {
      id: "one",
      purchase_id: null,
      supplier_id: null,
      invoice_date: null,
      invoice_number: "INV-07",
      suppliers: null,
      flags: [],
      status: "ready",
    },
  ]);
  jest
    .mocked(confirmAndDeleteInvoiceDraft)
    .mockResolvedValue({ result: "error", key: "invoices.deleteBusy" });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<InvoiceList />);
  });
  const del = tree.root
    .findAllByType(Pressable)
    .find((p) => p.findAllByType(Text).some((n) => n.props.children === "invoices.deleteDraft"))!;
  await act(async () => {
    await del.props.onPress();
  });
  const texts = tree.root.findAllByType(Text).map((n) => n.props.children);
  expect(texts).toContain("invoices.deleteBusy");
  expect(texts).toContain("invoices.deleteDraft");
  act(() => tree.unmount());
});
