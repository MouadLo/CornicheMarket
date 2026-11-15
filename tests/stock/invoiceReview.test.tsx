import React from "react";
import { Pressable, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import InvoiceScreen from "../../app/(app)/stock-in/invoice/[id]";
import { BigButton } from "../../src/components/BigButton";
import { ProductSearchPicker } from "../../src/components/stock/ProductSearchPicker";
import {
  approveInvoiceDraft,
  fetchInvoiceDraft,
  updateInvoiceHeader,
} from "../../src/lib/stock/invoices";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ id: "draft-1" }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { unit?: string }) =>
      key === "invoices.billingUnit" ? key + " " + options?.unit : key,
    i18n: { language: "en" },
  }),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { role: "owner" } }),
}));
jest.mock("../../src/lib/stock/queries", () => ({
  fetchSuppliers: async () => [{ id: "supplier-1", name: "Supplier" }],
}));
jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("../../src/components/stock/ProductSearchPicker", () => ({
  ProductSearchPicker: () => null,
}));
jest.mock("../../src/lib/stock/invoices", () => ({
  ...jest.requireActual("../../src/lib/stock/invoices"),
  fetchInvoiceDraft: jest.fn(),
  approveInvoiceDraft: jest.fn(),
  updateInvoiceHeader: jest.fn(),
}));

const draft = {
  id: "draft-1",
  revision: 1,
  invoice_number: "DEMO-001",
  supplier_id: "supplier-1",
  invoice_date: null,
  status: "ready" as const,
  flags: ["totals_mismatch" as const],
  photo_paths: [],
  extraction: null,
  extraction_started_at: null,
  extraction_error: null,
  suppliers: { name: "Supplier" },
  purchase_id: null,
  source_lines: [
    {
      description: "Milk",
      billed: "2 cases × 12",
      quantity: "24",
      unit: "piece" as const,
      unit_cost: "9",
    },
  ],
};
it("submits the corrected quantities and costs only after the owner reconfirms", async () => {
  jest.mocked(fetchInvoiceDraft).mockResolvedValue(draft);
  jest.mocked(approveInvoiceDraft).mockResolvedValue("purchase-1");

  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<InvoiceScreen />);
  });
  const approve = () =>
    tree.root.findAllByType(BigButton).find((b) => b.props.label === "invoices.approve")!;
  const toggleConfirmed = () =>
    tree.root
      .findAllByType(Pressable)
      .find((p) => p.props.accessibilityRole === "checkbox")!
      .props.onPress();

  expect(approve().props.disabled).toBe(true);
  act(() =>
    tree.root
      .findByType(ProductSearchPicker)
      .props.onPick({ id: "milk", name: "Milk", unit: "piece" })
  );
  act(toggleConfirmed);
  expect(approve().props.disabled).toBe(false);

  const [quantityInput, costInput] = tree.root.findAllByType(TextInput);
  act(() => {
    quantityInput.props.onChangeText("١٢");
    costInput.props.onChangeText("٩٫٥٠");
  });
  expect(approve().props.disabled).toBe(true);
  expect(approveInvoiceDraft).not.toHaveBeenCalled();

  act(toggleConfirmed);
  await act(async () => {
    await approve().props.onPress();
  });
  expect(approveInvoiceDraft).toHaveBeenCalledTimes(1);
  expect(approveInvoiceDraft).toHaveBeenCalledWith(draft, [
    {
      product_id: "milk",
      new_product: null,
      unit: "piece",
      quantity: 12,
      unit_cost_cents: 950,
    },
  ]);
  act(() => tree.unmount());
});

describe("buildReviewedInvoiceLine", () => {
  const { buildReviewedInvoiceLine } = jest.requireActual("../../src/lib/stock/invoices");
  const existing = (unit: "piece" | "kg" | "pack") => ({
    kind: "existing" as const,
    id: "p1",
    name: "Milk",
    unit,
  });

  it("turns typed text into integer centimes and a number quantity", () => {
    expect(
      buildReviewedInvoiceLine({ product: existing("piece"), quantity: "24", unitCost: "9,50" })
    ).toEqual({
      product_id: "p1",
      new_product: null,
      unit: "piece",
      quantity: 24,
      unit_cost_cents: 950,
    });
  });

  it("weighed products take up to 3 decimals; pieces and packs only whole units", () => {
    expect(
      buildReviewedInvoiceLine({ product: existing("kg"), quantity: "1,250", unitCost: "30" })
        ?.quantity
    ).toBe(1.25);
    expect(
      buildReviewedInvoiceLine({ product: existing("piece"), quantity: "1.5", unitCost: "3" })
    ).toBeNull();
    expect(
      buildReviewedInvoiceLine({ product: existing("kg"), quantity: "1.2345", unitCost: "3" })
    ).toBeNull();
  });

  it("refuses a zero quantity, a cost with 3 decimals, and a line with no product", () => {
    expect(
      buildReviewedInvoiceLine({ product: existing("piece"), quantity: "0", unitCost: "3" })
    ).toBeNull();
    expect(
      buildReviewedInvoiceLine({ product: existing("piece"), quantity: "2", unitCost: "3.125" })
    ).toBeNull();
    expect(buildReviewedInvoiceLine({ product: null, quantity: "2", unitCost: "3" })).toBeNull();
  });

  it("a new product needs a name and a selling price", () => {
    const fresh = (name: string, sellingPrice: string) => ({
      kind: "new" as const,
      name,
      unit: "piece" as const,
      sellingPrice,
    });
    expect(
      buildReviewedInvoiceLine({ product: fresh("Jus", "6"), quantity: "6", unitCost: "4" })
        ?.new_product
    ).toEqual({ name: "Jus", selling_price_cents: 600 });
    expect(
      buildReviewedInvoiceLine({ product: fresh("  ", "6"), quantity: "6", unitCost: "4" })
    ).toBeNull();
    expect(
      buildReviewedInvoiceLine({ product: fresh("Jus", ""), quantity: "6", unitCost: "4" })
    ).toBeNull();
  });
});

describe("approvalErrorKey: the server's refusals in the owner's language", () => {
  const { approvalErrorKey } = jest.requireActual("../../src/lib/stock/invoices");
  it.each([
    ["CM409", false, "invoices.changed"],
    [null, true, "invoices.changed"],
    ["CM412", false, "invoices.productChanged"],
    ["CM413", false, "invoices.approvedDifferently"],
    ["22023", false, "invoices.invalidLines"],
    ["42501", false, "invoices.approveError"],
    [null, false, "invoices.approveError"],
  ])("%s (revision changed: %s) -> %s", (code, changed, key) => {
    expect(approvalErrorKey(code, changed)).toBe(key);
  });
});

it("warns about extraction and saves the missing invoice header against its revision", async () => {
  const missing = { ...draft, invoice_number: null, supplier_id: null };
  jest.mocked(fetchInvoiceDraft).mockResolvedValue(missing);
  jest.mocked(updateInvoiceHeader).mockResolvedValue(2);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<InvoiceScreen />);
  });
  expect(JSON.stringify(tree.toJSON())).toContain("invoices.totals_mismatch");
  expect(JSON.stringify(tree.toJSON())).toContain("invoices.missingHeader");
  const button = (label: string) =>
    tree.root.findAllByType(BigButton).find((b) => b.props.label === label)!;
  await act(async () => {
    button("invoices.editHeader").props.onPress();
  });
  act(() => {
    tree.root
      .findAllByType(Pressable)
      .find((p) => p.props.accessibilityRole === "radio")!
      .props.onPress();
    tree.root
      .findAllByType(TextInput)
      .find((p) => p.props.accessibilityLabel === "invoices.invoiceNumber")!
      .props.onChangeText("INV-10");
  });
  await act(async () => {
    await button("invoices.saveHeader").props.onPress();
  });
  expect(updateInvoiceHeader).toHaveBeenCalledWith(missing, "supplier-1", "INV-10", "");
  expect(JSON.stringify(tree.toJSON())).not.toContain("invoices.missingHeader");
  act(() => tree.unmount());
});

it("displays the billing unit warning and the printed unit beside the blank review fields", async () => {
  jest.mocked(fetchInvoiceDraft).mockResolvedValue({
    ...draft,
    flags: ["unit_check"],
    source_lines: [
      { ...draft.source_lines[0], billing_unit: "carton de 6", quantity: "", unit_cost: "" },
    ],
  });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<InvoiceScreen />);
  });
  const content = JSON.stringify(tree.toJSON());
  expect(content).toContain("invoices.unit_check");
  expect(content).toMatch(/invoices\.billingUnit[^\"]*carton de 6/);
  expect(content).not.toContain("invoices.unreadable_lines");
  const fields = tree.root.findAllByType(TextInput);
  expect(fields.map((field) => field.props.value)).toEqual(["", ""]);
  act(() => tree.unmount());
});
