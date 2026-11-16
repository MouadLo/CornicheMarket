import React from "react";
import { Pressable, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import InvoiceScreen from "../../app/(app)/stock-in/invoice/[id]";
import { BigButton } from "../../src/components/BigButton";
import { ProductSearchPicker } from "../../src/components/stock/ProductSearchPicker";
import { createSupplier as createSupplierMock } from "../../src/lib/stock/queries";
import {
  approveInvoiceDraft,
  fetchInvoiceDraft,
  matchInvoiceLines,
  updateInvoiceHeader,
} from "../../src/lib/stock/invoices";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ id: "draft-1" }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { unit?: string; name?: string }) =>
      key === "invoices.billingUnit" || key === "invoices.unitsPer"
        ? key + " " + options?.unit
        : key === "invoices.suggestion" || key === "invoices.matched"
          ? key + " " + options?.name
          : key,
    i18n: { language: "en" },
  }),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { role: "owner" } }),
}));
jest.mock("../../src/lib/stock/queries", () => ({
  fetchSuppliers: async () => [{ id: "supplier-1", name: "Supplier" }],
  createSupplier: jest.fn(async (name: string) => ({ id: "supplier-new", name, phone: null })),
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
  matchInvoiceLines: jest.fn(async () => []),
}));

beforeEach(() => {
  jest.mocked(matchInvoiceLines).mockResolvedValue([]);
});

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
      units_per_billing_unit: null,
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
      buildReviewedInvoiceLine({
        product: existing("piece"),
        quantity: "24",
        unitCost: "9,50",
        unitsPer: "",
      })
    ).toEqual({
      product_id: "p1",
      new_product: null,
      unit: "piece",
      quantity: 24,
      unit_cost_cents: 950,
      units_per_billing_unit: null,
    });
  });

  it("weighed products take up to 3 decimals; pieces and packs only whole units", () => {
    expect(
      buildReviewedInvoiceLine({
        product: existing("kg"),
        quantity: "1,250",
        unitCost: "30",
        unitsPer: "",
      })?.quantity
    ).toBe(1.25);
    expect(
      buildReviewedInvoiceLine({
        product: existing("piece"),
        quantity: "1.5",
        unitCost: "3",
        unitsPer: "",
      })
    ).toBeNull();
    expect(
      buildReviewedInvoiceLine({
        product: existing("kg"),
        quantity: "1.2345",
        unitCost: "3",
        unitsPer: "",
      })
    ).toBeNull();
  });

  it("refuses a zero quantity, a cost with 3 decimals, and a line with no product", () => {
    expect(
      buildReviewedInvoiceLine({
        product: existing("piece"),
        quantity: "0",
        unitCost: "3",
        unitsPer: "",
      })
    ).toBeNull();
    expect(
      buildReviewedInvoiceLine({
        product: existing("piece"),
        quantity: "2",
        unitCost: "3.125",
        unitsPer: "",
      })
    ).toBeNull();
    expect(
      buildReviewedInvoiceLine({ product: null, quantity: "2", unitCost: "3", unitsPer: "" })
    ).toBeNull();
  });

  it("a new product needs a name and a selling price", () => {
    const fresh = (name: string, sellingPrice: string) => ({
      kind: "new" as const,
      name,
      unit: "piece" as const,
      sellingPrice,
    });
    expect(
      buildReviewedInvoiceLine({
        product: fresh("Jus", "6"),
        quantity: "6",
        unitCost: "4",
        unitsPer: "",
      })?.new_product
    ).toEqual({ name: "Jus", selling_price_cents: 600 });
    expect(
      buildReviewedInvoiceLine({
        product: fresh("  ", "6"),
        quantity: "6",
        unitCost: "4",
        unitsPer: "",
      })
    ).toBeNull();
    expect(
      buildReviewedInvoiceLine({
        product: fresh("Jus", ""),
        quantity: "6",
        unitCost: "4",
        unitsPer: "",
      })
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
    ["CM414", false, "invoices.futureDate"],
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
  // The details open by themselves when the supplier or number is missing.
  expect(button("common.cancel")).toBeDefined();
  expect(button("invoices.editHeader")).toBeUndefined();
  await act(async () => {});
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

it("creates the supplier read from the invoice when it is new, and selects it", async () => {
  const missing = {
    ...draft,
    supplier_id: null,
    invoice_number: "F/ASB/0198857",
    extraction: { supplier_name: "Les Eaux Minerales dOulmes SA", invoice_number: "F/ASB/0198857" },
  };
  jest.mocked(fetchInvoiceDraft).mockResolvedValue(missing);
  jest.mocked(updateInvoiceHeader).mockResolvedValue(2);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<InvoiceScreen />);
  });
  await act(async () => {});
  const button = (label: string) =>
    tree.root.findAllByType(BigButton).find((b) => b.props.label === label);
  const createButton = tree.root
    .findAllByType(BigButton)
    .find((b) => String(b.props.label).startsWith("invoices.createSupplier"))!;
  expect(createButton).toBeDefined();
  await act(async () => {
    await createButton.props.onPress();
  });
  expect(jest.mocked(createSupplierMock)).toHaveBeenCalledWith(
    "Les Eaux Minerales dOulmes SA",
    null
  );
  // Created once: the button goes away and the new supplier is selected.
  expect(
    tree.root
      .findAllByType(BigButton)
      .some((b) => String(b.props.label).startsWith("invoices.createSupplier"))
  ).toBe(false);
  await act(async () => {
    await button("invoices.saveHeader")!.props.onPress();
  });
  expect(updateInvoiceHeader).toHaveBeenCalledWith(missing, "supplier-new", "F/ASB/0198857", "");
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
  // "carton de 6" names its count; quantity and cost stay blank without printed values.
  expect(fields.map((field) => field.props.value)).toEqual(["6", "", ""]);
  act(() => tree.unmount());
});

// Names and units are wrapped in bidi isolates for RTL; compare the text.
const plain = (text: string) => text.replace(/[\u2066-\u2069]/g, "");

const cartonLine = {
  description: "Eau 1.5 L",
  billed: "2 cartons · 30,00",
  billing_unit: "carton de 6",
  billed_quantity: "2",
  billed_unit_cost: "30.00",
  quantity: "",
  unit: "piece" as const,
  unit_cost: "",
};

it("converts a carton line into pieces once the owner says how many are in a carton", async () => {
  jest
    .mocked(fetchInvoiceDraft)
    .mockResolvedValue({ ...draft, totals: { price_basis: "ttc" }, source_lines: [cartonLine] });
  jest.mocked(approveInvoiceDraft).mockClear().mockResolvedValue("purchase-1");
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<InvoiceScreen />);
  });
  const field = (label: string) =>
    tree.root.findAllByType(TextInput).find((f) => f.props.accessibilityLabel?.startsWith(label))!;
  expect(plain(field("invoices.unitsPer").props.accessibilityLabel)).toBe(
    "invoices.unitsPer carton de 6"
  );
  // Pre-filled from "carton de 6"; the owner can still correct it.
  expect(field("invoices.unitsPer").props.value).toBe("6");
  expect(field("invoices.quantity").props.value).toBe("12");
  act(() => field("invoices.unitsPer").props.onChangeText("12"));
  expect(field("invoices.quantity").props.value).toBe("24");
  expect(field("invoices.unitCost").props.value).toBe("2.50");
  act(() => field("invoices.unitsPer").props.onChangeText("6"));
  expect(field("invoices.unitCost").props.value).toBe("5.00");

  act(() =>
    tree.root
      .findByType(ProductSearchPicker)
      .props.onPick({ id: "water", name: "Eau", unit: "piece" })
  );
  act(() =>
    tree.root
      .findAllByType(Pressable)
      .find((p) => p.props.accessibilityRole === "checkbox")!
      .props.onPress()
  );
  await act(async () => {
    await tree.root
      .findAllByType(BigButton)
      .find((b) => b.props.label === "invoices.approve")!
      .props.onPress();
  });
  expect(approveInvoiceDraft).toHaveBeenCalledWith(expect.anything(), [
    {
      product_id: "water",
      new_product: null,
      unit: "piece",
      quantity: 12,
      unit_cost_cents: 500,
      units_per_billing_unit: 6,
      printed_unit_cost_cents: 3000,
      printed_basis: "ttc",
      cost_basis: "ttc",
      vat_percent: null,
    },
  ]);
  act(() => tree.unmount());
});

it("pre-fills the product and pack size remembered for this supplier", async () => {
  jest
    .mocked(fetchInvoiceDraft)
    .mockResolvedValue({ ...draft, totals: { price_basis: "ttc" }, source_lines: [cartonLine] });
  jest.mocked(matchInvoiceLines).mockResolvedValue([
    {
      line_index: 0,
      product_id: "water",
      product_name: "Eau Sidi Ali 1.5L",
      product_unit: "piece",
      units_per_billing_unit: 6,
      exact: true,
      score: 1,
    },
  ]);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<InvoiceScreen />);
  });
  const content = plain(JSON.stringify(tree.toJSON()));
  expect(content).toContain("invoices.matched Eau Sidi Ali 1.5L");
  expect(content).toContain("invoices.remembered");
  const value = (label: string) =>
    tree.root
      .findAllByType(TextInput)
      .find((f) => plain(String(f.props.accessibilityLabel)).startsWith(label))!.props.value;
  expect([
    value("invoices.unitsPer"),
    value("invoices.quantity"),
    value("invoices.unitCost"),
  ]).toEqual(["6", "12", "5.00"]);
  act(() => tree.unmount());
});

it("offers name suggestions without choosing one for the owner", async () => {
  jest.mocked(fetchInvoiceDraft).mockResolvedValue(draft);
  jest.mocked(matchInvoiceLines).mockResolvedValue([
    {
      line_index: 0,
      product_id: "milk-1",
      product_name: "Lait Centrale 1L",
      product_unit: "piece",
      units_per_billing_unit: null,
      exact: false,
      score: 0.8,
    },
    {
      line_index: 0,
      product_id: "milk-2",
      product_name: "Lait demi-écrémé",
      product_unit: "piece",
      units_per_billing_unit: null,
      exact: false,
      score: 0.4,
    },
  ]);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<InvoiceScreen />);
  });
  const suggestions = () =>
    tree.root
      .findAllByType(BigButton)
      .filter((b) => String(b.props.label).startsWith("invoices.suggestion"));
  expect(suggestions().map((b) => plain(b.props.label))).toEqual([
    "invoices.suggestion Lait Centrale 1L",
    "invoices.suggestion Lait demi-écrémé",
  ]);
  expect(plain(JSON.stringify(tree.toJSON()))).not.toContain("invoices.matched");
  act(() => suggestions()[0].props.onPress());
  expect(plain(JSON.stringify(tree.toJSON()))).toContain("invoices.matched Lait Centrale 1L");
  expect(suggestions()).toHaveLength(0);
  act(() => tree.unmount());
});

it("shows the server's duplicate check after the header is saved", async () => {
  jest
    .mocked(fetchInvoiceDraft)
    .mockResolvedValueOnce(draft)
    .mockResolvedValueOnce({
      ...draft,
      revision: 2,
      invoice_number: "FAC-77",
      flags: ["duplicate_invoice"],
    });
  jest.mocked(updateInvoiceHeader).mockResolvedValue(2);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<InvoiceScreen />);
  });
  const button = (label: string) =>
    tree.root.findAllByType(BigButton).find((b) => b.props.label === label)!;
  await act(async () => {
    button("invoices.editHeader").props.onPress();
  });
  act(() =>
    tree.root
      .findAllByType(TextInput)
      .find((p) => p.props.accessibilityLabel === "invoices.invoiceNumber")!
      .props.onChangeText("FAC-77")
  );
  await act(async () => {
    await button("invoices.saveHeader").props.onPress();
  });
  expect(plain(JSON.stringify(tree.toJSON()))).toContain("invoices.duplicate_invoice");
  act(() => tree.unmount());
});

describe("choosing a product on a billed line", () => {
  const { withProduct, isPackLine } = jest.requireActual("../../src/lib/stock/invoices");
  const kiloLine = {
    description: "Tomates",
    billed: "12,5 kg",
    billing_unit: "kg",
    billed_quantity: "12.5",
    billed_unit_cost: "6.40",
    quantity: "",
    unit: "piece" as const,
    unit_cost: "",
  };
  const empty = { product: null, quantity: "", unitCost: "", unitsPer: "" };
  const product = (unit: "piece" | "kg") => ({ kind: "existing", id: "p", name: "Tomates", unit });

  it("takes the printed weight and price per kg for a product sold by weight", () => {
    expect(withProduct(kiloLine, empty, product("kg"))).toMatchObject({
      quantity: "12.5",
      unitCost: "6.40",
    });
  });

  it("leaves a weight line blank for a product counted in pieces", () => {
    expect(withProduct(kiloLine, empty, product("piece"))).toMatchObject({
      quantity: "",
      unitCost: "",
    });
  });

  it("clears numbers typed for another stock unit, including the pack size", () => {
    const typed = { product: product("piece"), quantity: "12", unitCost: "5", unitsPer: "6" };
    expect(withProduct(kiloLine, typed, product("kg"))).toMatchObject({ unitsPer: "" });
    expect(withProduct({ ...kiloLine, billing_unit: null }, typed, null)).toEqual({
      ...typed,
      product: null,
    });
  });

  it("asks for a pack size only for cartons and packs, not weight or pieces", () => {
    expect(isPackLine({ ...kiloLine, billing_unit: "carton de 12" })).toBe(true);
    expect(isPackLine(kiloLine)).toBe(false);
    expect(isPackLine({ ...kiloLine, billing_unit: "pièce" })).toBe(false);
    expect(isPackLine({ ...kiloLine, billing_unit: null })).toBe(false);
  });
});

describe("HT and TTC prices", () => {
  const htLine = {
    description: "Lait 1 L",
    billed: "6 · 8,50 · 51,00",
    billing_unit: null,
    billed_quantity: "6",
    billed_unit_cost: "8.50",
    vat_percent: 20,
    quantity: "6",
    unit: "piece" as const,
    unit_cost: "8.50",
  };
  const render = async (extra: object, line: object = htLine) => {
    jest.mocked(fetchInvoiceDraft).mockResolvedValue({
      ...draft,
      source_lines: [line],
      ...extra,
    } as never);
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<InvoiceScreen />);
    });
    return tree;
  };
  const field = (tree: ReactTestRenderer, label: string) =>
    tree.root.findAllByType(TextInput).find((f) => f.props.accessibilityLabel?.startsWith(label))!;
  const radio = (tree: ReactTestRenderer, label: string) =>
    tree.root
      .findAllByType(Pressable)
      .find((p) => plain(String(p.props.accessibilityLabel ?? "")) === label)!;

  it("stores an HT invoice price as the TTC cost by default, and says how", async () => {
    const tree = await render({ totals: { price_basis: "ht" } });
    expect(field(tree, "invoices.unitCost").props.value).toBe("10.20");
    const content = plain(JSON.stringify(tree.toJSON()));
    expect(content).toContain("invoices.basisDetected");
    expect(content).toContain("invoices.costConverted");
    act(() => tree.unmount());
  });

  it("stores the printed HT price as it is when the owner chooses an HT cost", async () => {
    const tree = await render({ totals: { price_basis: "ht" } });
    act(() => radio(tree, "invoices.costBasis invoices.basisHT").props.onPress());
    expect(field(tree, "invoices.unitCost").props.value).toBe("8.50");
    expect(plain(JSON.stringify(tree.toJSON()))).not.toContain("invoices.costConverted");
    act(() => tree.unmount());
  });

  it("removes TVA from a TTC invoice price when the owner chooses an HT cost", async () => {
    const tree = await render(
      { totals: { price_basis: "ttc" } },
      { ...htLine, billed_unit_cost: "10.20", unit_cost: "10.20" }
    );
    expect(field(tree, "invoices.unitCost").props.value).toBe("10.20");
    act(() => radio(tree, "invoices.costBasis invoices.basisHT").props.onPress());
    expect(field(tree, "invoices.unitCost").props.value).toBe("8.50");
    act(() => tree.unmount());
  });

  it("keeps a cost the owner typed when the basis changes, and says so", async () => {
    const tree = await render({ totals: { price_basis: "ht" } });
    act(() => field(tree, "invoices.unitCost").props.onChangeText("11"));
    act(() => radio(tree, "invoices.costBasis invoices.basisHT").props.onPress());
    expect(field(tree, "invoices.unitCost").props.value).toBe("11");
    expect(plain(JSON.stringify(tree.toJSON()))).toContain("invoices.costTouched");
    act(() => tree.unmount());
  });

  it("asks which it is, and fills nothing, when the invoice does not say", async () => {
    const tree = await render({ totals: { price_basis: null } });
    expect(plain(JSON.stringify(tree.toJSON()))).toContain("invoices.basisUnknown");
    expect(field(tree, "invoices.unitCost").props.value).toBe("");
    act(() => radio(tree, "invoices.printedBasis invoices.basisHT").props.onPress());
    expect(field(tree, "invoices.unitCost").props.value).toBe("10.20");
    expect(plain(JSON.stringify(tree.toJSON()))).not.toContain("invoices.basisUnknown");
    act(() => tree.unmount());
  });

  const content = (tree: ReactTestRenderer) => plain(JSON.stringify(tree.toJSON()));

  it("shows the invoice line as read, and takes its discount off before converting", async () => {
    const tree = await render(
      { totals: { price_basis: "ht" } },
      { ...htLine, discount_text: "10%" }
    );
    expect(field(tree, "invoices.billedQuantity").props.value).toBe("6");
    expect(field(tree, "invoices.printedPrice").props.value).toBe("8.50");
    expect(field(tree, "invoices.lineDiscount").props.value).toBe("10%");
    // 8.50 HT less 10% = 7.65 HT, plus 20% TVA = 9.18 TTC
    expect(field(tree, "invoices.unitCost").props.value).toBe("9.18");
    expect(content(tree)).toContain("invoices.lineAmounts");
    // The note says the discount went into the cost, not just TVA.
    expect(content(tree)).toContain("invoices.costConvertedDiscounted");
    expect(content(tree)).not.toContain("invoices.costConverted ");
    act(() => tree.unmount());
  });

  it("recomputes quantity and cost when the owner corrects the invoice line", async () => {
    const tree = await render({ totals: { price_basis: "ht" } });
    act(() => field(tree, "invoices.lineDiscount").props.onChangeText("24,24-"));
    // 6 x 8.50 = 51.00 less 24.24 = 26.76 HT, so 4.46 each HT, 5.35 TTC
    expect(field(tree, "invoices.unitCost").props.value).toBe("5.35");
    act(() => field(tree, "invoices.billedQuantity").props.onChangeText("5"));
    expect(field(tree, "invoices.quantity").props.value).toBe("5");
    act(() => field(tree, "invoices.lineDiscount").props.onChangeText(""));
    act(() => field(tree, "invoices.printedPrice").props.onChangeText("9,00"));
    expect(field(tree, "invoices.unitCost").props.value).toBe("10.80");
    act(() => tree.unmount());
  });

  it("checks each line against its printed total", async () => {
    const good = await render(
      { totals: { price_basis: "ht" } },
      { ...htLine, line_total: "51.00" }
    );
    expect(content(good)).toContain("invoices.lineTotalMatches");
    act(() => good.unmount());
    const bad = await render({ totals: { price_basis: "ht" } }, { ...htLine, line_total: "45.00" });
    expect(content(bad)).toContain("invoices.lineTotalDiffers");
    act(() => bad.unmount());
  });

  it("leaves the cost blank while the discount cannot be read", async () => {
    const tree = await render(
      { totals: { price_basis: "ht" } },
      { ...htLine, discount_text: "spécial" }
    );
    expect(content(tree)).toContain("invoices.discountUnread");
    expect(field(tree, "invoices.unitCost").props.value).toBe("");
    act(() => field(tree, "invoices.lineDiscount").props.onChangeText("5%"));
    expect(field(tree, "invoices.unitCost").props.value).not.toBe("");
    act(() => tree.unmount());
  });

  it("shows the invoice totals, editable, and whether the lines match them", async () => {
    const tree = await render({
      totals: { price_basis: "ht", subtotal_ht: 5100, vat_total: 1020, total_ttc: 6120 },
    });
    expect(content(tree)).toContain("invoices.totalsTitle");
    expect(field(tree, "invoices.totalHT").props.value).toBe("51.00");
    expect(content(tree)).toContain("invoices.totalsMatch");
    act(() => field(tree, "invoices.totalHT").props.onChangeText("60,00"));
    expect(content(tree)).toContain("invoices.totalsDiffer");
    expect(content(tree)).toContain("invoices.vatOff");
    act(() => tree.unmount());
  });

  it("applies a discount on the whole invoice the totals confirm, and lets the owner switch it off", async () => {
    // 51.00 HT less 5% = 48.45, the printed HT total
    const tree = await render({
      totals: { price_basis: "ht", subtotal_ht: 4845, global_discount_text: "5%" },
    });
    expect(field(tree, "invoices.globalDiscountLabel").props.value).toBe("5%");
    expect(content(tree)).toContain("invoices.afterGlobal");
    expect(content(tree)).toContain("invoices.totalsMatch");
    // 8.50 less 5% = 8.075 HT, 9.69 TTC
    expect(field(tree, "invoices.unitCost").props.value).toBe("9.69");
    const toggle = tree.root
      .findAllByType(Pressable)
      .find(
        (p) => p.props.accessibilityRole === "checkbox" && p.props.accessibilityState?.checked
      )!;
    act(() => toggle.props.onPress());
    expect(field(tree, "invoices.unitCost").props.value).toBe("10.20");
    expect(content(tree)).toContain("invoices.totalsDiffer");
    act(() => tree.unmount());
  });

  it("does not apply an invoice discount the lines already include", async () => {
    const tree = await render({
      totals: { price_basis: "ht", subtotal_ht: 5100, global_discount_text: "5%" },
    });
    expect(content(tree)).toContain("invoices.globalIncluded");
    expect(field(tree, "invoices.unitCost").props.value).toBe("10.20");
    act(() => tree.unmount());
  });

  it("applies an invoice discount the owner types when the totals confirm it, not one they already include", async () => {
    const tree = await render({ totals: { price_basis: "ht", subtotal_ht: 4845 } });
    expect(field(tree, "invoices.unitCost").props.value).toBe("10.20");
    act(() => field(tree, "invoices.globalDiscountLabel").props.onChangeText("5%"));
    expect(field(tree, "invoices.unitCost").props.value).toBe("9.69");
    act(() => tree.unmount());
    const included = await render({ totals: { price_basis: "ht", subtotal_ht: 5100 } });
    act(() => field(included, "invoices.globalDiscountLabel").props.onChangeText("5%"));
    expect(field(included, "invoices.unitCost").props.value).toBe("10.20");
    expect(content(included)).toContain("invoices.globalIncluded");
    act(() => included.unmount());
  });

  it("reads a pack count from the name and says so", async () => {
    const tree = await render(
      { totals: { price_basis: "ht" } },
      {
        ...htLine,
        description: "COCA-COLA PET 45*12",
        billed_quantity: "8",
        billed_unit_cost: "50.50",
      }
    );
    expect(field(tree, "invoices.unitsPerPack").props.value).toBe("12");
    expect(field(tree, "invoices.quantity").props.value).toBe("96");
    expect(content(tree)).toContain("invoices.unitsFromName");
    act(() => tree.unmount());
  });

  it("lets the owner say a line is a pack when nothing printed says so", async () => {
    const tree = await render({ totals: { price_basis: "ht" } });
    expect(field(tree, "invoices.unitsPerPack")).toBeUndefined();
    const open = tree.root
      .findAllByType(BigButton)
      .find((button) => button.props.label === "invoices.openPackSize")!;
    act(() => open.props.onPress());
    expect(content(tree)).toContain("invoices.unitsPerPackHint");
    act(() => field(tree, "invoices.unitsPerPack").props.onChangeText("6"));
    expect(field(tree, "invoices.quantity").props.value).toBe("36");
    act(() => tree.unmount());
  });

  it("says what is left to do on each line and above the approve button", async () => {
    const tree = await render({ totals: { price_basis: "ht" } });
    expect(content(tree)).toContain("invoices.lineTodo");
    expect(content(tree)).toContain("invoices.issue_product");
    expect(content(tree)).toContain("invoices.linesTodo");
    const create = tree.root
      .findAllByType(BigButton)
      .find((button) => button.props.label === "invoices.createProduct")!;
    act(() => create.props.onPress());
    expect(content(tree)).toContain("invoices.issue_sellingPrice");
    act(() => field(tree, "invoices.sellingPrice").props.onChangeText("12"));
    expect(content(tree)).not.toContain("invoices.lineTodo");
    expect(content(tree)).not.toContain("invoices.linesTodo");
    act(() => tree.unmount());
  });

  it("says when the invoice discount cannot be read", async () => {
    const tree = await render({ totals: { price_basis: "ht", global_discount_text: "spécial" } });
    expect(content(tree)).toContain("invoices.globalDiscountUnread");
    act(() => tree.unmount());
  });

  it("leaves the cost blank with a reason when a conversion needs a TVA rate that is missing", async () => {
    const tree = await render({ totals: { price_basis: "ht" } }, { ...htLine, vat_percent: null });
    expect(field(tree, "invoices.unitCost").props.value).toBe("");
    expect(plain(JSON.stringify(tree.toJSON()))).toContain("invoices.vatMissing");
    // Storing the printed basis needs no rate.
    act(() => radio(tree, "invoices.costBasis invoices.basisHT").props.onPress());
    expect(field(tree, "invoices.unitCost").props.value).toBe("8.50");
    act(() => tree.unmount());
  });

  it("sends the printed price, both bases and the rate with the approved line", async () => {
    jest.mocked(approveInvoiceDraft).mockClear().mockResolvedValue("purchase-1");
    const tree = await render({ totals: { price_basis: "ht" } });
    act(() =>
      tree.root
        .findByType(ProductSearchPicker)
        .props.onPick({ id: "milk", name: "Lait", unit: "piece" })
    );
    act(() =>
      tree.root
        .findAllByType(Pressable)
        .find((p) => p.props.accessibilityRole === "checkbox")!
        .props.onPress()
    );
    await act(async () => {
      await tree.root
        .findAllByType(BigButton)
        .find((b) => b.props.label === "invoices.approve")!
        .props.onPress();
    });
    expect(approveInvoiceDraft).toHaveBeenCalledWith(expect.anything(), [
      {
        product_id: "milk",
        new_product: null,
        unit: "piece",
        quantity: 6,
        unit_cost_cents: 1020,
        units_per_billing_unit: null,
        printed_unit_cost_cents: 850,
        printed_basis: "ht",
        cost_basis: "ttc",
        vat_percent: 20,
      },
    ]);
    act(() => tree.unmount());
  });

  it("converts a carton price and divides it in one step", async () => {
    const tree = await render(
      { totals: { price_basis: "ht" } },
      {
        ...htLine,
        billing_unit: "carton de 12",
        billed_quantity: "2",
        billed_unit_cost: "102.00",
        quantity: "",
        unit_cost: "",
      }
    );
    expect(field(tree, "invoices.unitsPer").props.value).toBe("12");
    expect(field(tree, "invoices.quantity").props.value).toBe("24");
    expect(field(tree, "invoices.unitCost").props.value).toBe("10.20");
    act(() => tree.unmount());
  });

  it("shows no basis choice for an older draft that has no printed prices to convert", async () => {
    const tree = await render(
      {},
      { ...htLine, billed_unit_cost: undefined, vat_percent: undefined }
    );
    expect(plain(JSON.stringify(tree.toJSON()))).not.toContain("invoices.priceBasisTitle");
    expect(field(tree, "invoices.unitCost").props.value).toBe("8.50");
    act(() => tree.unmount());
  });
});
