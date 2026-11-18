import React from "react";
import { Platform, Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import Screen from "../../app/(app)/stock-in/count";
import { BigButton } from "../../src/components/BigButton";

const mockApply = jest.fn();
const mockLowStock = jest.fn();
const mockForCount = jest.fn();
const mockConfirm = jest.fn();
const mockStock = jest.fn();
const mockListeners: ((event: { preventDefault: () => void; data: unknown }) => void)[] = [];
let mockRole = "owner";
let mockSequence = 0;
let mockPick: (product: unknown) => void = () => undefined;

jest.mock("expo-crypto", () => ({ randomUUID: () => `operation-${++mockSequence}` }));
jest.mock("expo-router", () => ({
  useNavigation: () => ({
    addListener: (_name: string, listener: (typeof mockListeners)[number]) => {
      mockListeners.push(listener);
      return () => undefined;
    },
    dispatch: jest.fn(),
  }),
}));
jest.mock("../../src/lib/dialog/store", () => ({ confirm: jest.fn(async () => false) }));
jest.mock("../../src/lib/products/queries", () => ({
  fetchProductByBarcode: async (code: string) =>
    [mockProduct("milk", { barcode: "6111000000000" })].find((p) => p.barcode === code) ?? null,
  fetchCategories: async () => [
    { id: "drinks", name: "Boissons", parent_id: null },
    { id: "water", name: "Eaux", parent_id: "drinks" },
  ],
}));
jest.mock("../../src/lib/inventory/queries", () => ({
  applyStockCount: (...args: unknown[]) => mockApply(...args),
  fetchCurrentStock: (...args: unknown[]) => mockStock(...args),
  fetchLowStockProducts: (...args: unknown[]) => mockLowStock(...args),
  fetchProductsForCount: (...args: unknown[]) => mockForCount(...args),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "u1", role: mockRole } }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${Object.values(o).join("/")}` : k),
    i18n: { language: "fr" },
  }),
}));
jest.mock("../../src/lib/confirmDestructive", () => ({
  confirmDestructive: (...args: unknown[]) => mockConfirm(...args),
}));
jest.mock("../../src/components/stock/ProductSearchPicker", () => ({
  ProductSearchPicker: (props: { onPick: (product: unknown) => void }) => {
    mockPick = props.onPick;
    return null;
  },
}));
jest.mock("../../src/components/sell/ContinuousScanner", () => ({ ContinuousScanner: () => null }));

function mockProduct(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    barcode: null,
    category_id: null,
    unit: "piece",
    selling_price_cents: 100,
    stock_quantity: 10,
    low_stock_threshold: 0,
    is_low_stock: false,
    active: true,
    current_cost_cents: null,
    ...extra,
  };
}

let tree: ReactTestRenderer;
const inputs = () => tree.root.findAllByType(TextInput);
const type = (index: number, value: string) =>
  act(async () => inputs()[index].props.onChangeText(value));
const button = (label: string) =>
  tree.root.findAllByType(BigButton).find((b) => b.props.label === label);
const press = (label: string) => act(async () => button(label)!.props.onPress());
const allText = () =>
  tree.root
    .findAllByType(Text)
    .map((node) => [node.props.children].flat(Infinity).join(""))
    .join("\n");
// Presses the nearest pressable around some text.
const pressText = (text: string) =>
  act(async () => {
    let node = tree.root.findAll((n) => n.props.children === text)[0];
    while (node && typeof node.props.onPress !== "function") node = node.parent!;
    node.props.onPress();
  });

beforeEach(async () => {
  mockRole = "owner";
  mockListeners.length = 0;
  mockApply.mockReset().mockResolvedValue(-2);
  mockLowStock.mockReset();
  mockForCount.mockReset();
  mockConfirm.mockReset().mockResolvedValue(true);
  mockStock
    .mockReset()
    .mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, 10])));
  await act(async () => {
    tree = create(<Screen />);
  });
});
afterEach(() => act(() => tree.unmount()));

describe("starting from a list", () => {
  it("a category loads its products (with its sub-categories) into the count", async () => {
    mockForCount.mockResolvedValue([mockProduct("a"), mockProduct("b")]);
    await press("stockIn.countCategory");
    await pressText("\u2068Boissons\u2069");
    expect(mockForCount).toHaveBeenCalledWith(["drinks", "water"], true);
    expect(inputs()).toHaveLength(2);
    expect(allText()).toContain("stockIn.countProgress:0/2");
  });

  it("loading twice adds no duplicates and never overwrites typed work", async () => {
    mockLowStock.mockResolvedValue([mockProduct("a"), mockProduct("b")]);
    await press("stockIn.countLowStock");
    await type(0, "4");
    await press("stockIn.countApply:1");
    expect(mockApply).toHaveBeenCalledTimes(1);
    await press("stockIn.countLowStock");
    expect(inputs()).toHaveLength(2);
    expect(inputs()[0].props.value).toBe("4");
    expect(inputs()[0].props.editable).toBe(false);
  });

  it("adds to lines already typed, leaving them in place", async () => {
    await act(async () => mockPick(mockProduct("x")));
    await type(0, "9");
    mockLowStock.mockResolvedValue([mockProduct("a"), mockProduct("x")]);
    await press("stockIn.countLowStock");
    expect(inputs()).toHaveLength(2);
    expect(inputs()[0].props.value).toBe("9");
    expect(inputs()[1].props.value).toBe("");
  });
});

describe("an empty line is never applied", () => {
  beforeEach(async () => {
    mockLowStock.mockResolvedValue([mockProduct("a"), mockProduct("b"), mockProduct("c")]);
    await press("stockIn.countLowStock");
  });

  it("only typed lines are sent; a blank is not a zero", async () => {
    await type(0, "4");
    await type(1, "   ");
    expect(button("stockIn.countApply:1")).toBeDefined();
    await press("stockIn.countApply:1");
    expect(mockApply.mock.calls.map((c) => c[0])).toEqual(["a"]);
  });

  it("a typed 0 is sent as a real count of zero", async () => {
    await type(2, "0");
    await press("stockIn.countApply:1");
    expect(mockApply).toHaveBeenCalledTimes(1);
    expect(mockApply.mock.calls[0].slice(0, 3)).toEqual(["c", 0, 10]);
  });

  it("with nothing typed there is nothing to apply", () => {
    expect(button("stockIn.countApply:0")).toBeUndefined();
    expect(tree.root.findAllByType(BigButton).some((b) => /countApply/.test(b.props.label))).toBe(
      false
    );
  });

  it("the progress counts typed lines and the filter hides them", async () => {
    await type(0, "4");
    expect(allText()).toContain("stockIn.countProgress:1/3");
    await pressText("stockIn.countOnlyUncounted");
    // The line being worked on stays visible, so it does not vanish mid-typing.
    expect(inputs()).toHaveLength(3);
    await type(1, "2");
    // The first line is counted and no longer the one being worked on: hidden.
    expect(inputs()).toHaveLength(2);
  });
});

describe("large lists", () => {
  it("sends at most 5 at a time, keeps failures per line, and summarises the confirmation", async () => {
    const products = Array.from({ length: 23 }, (_, i) => mockProduct(`p${i}`));
    mockLowStock.mockResolvedValue(products);
    await press("stockIn.countLowStock");
    // Only the rows a phone would have drawn are typed into (the list is virtualized).
    for (let i = 0; i < 12; i++) await type(i, "3");

    let running = 0;
    let peak = 0;
    mockApply.mockImplementation(async (id: string) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      if (id === "p7") throw new Error("timeout");
      return -7;
    });
    await press("stockIn.countApply:12");

    expect(peak).toBeLessThanOrEqual(5);
    expect(mockApply).toHaveBeenCalledTimes(12);
    const message = mockConfirm.mock.calls[0][1] as string;
    expect(message.split("\n").length).toBeLessThan(10);
    expect(message).toContain("stockIn.countConfirmSummary");
    // Only the failed line is retryable and keeps its operation id.
    expect(button("stockIn.countApply:1")).toBeDefined();
    mockApply.mockClear().mockResolvedValue(-7);
    const firstId = mockSequence;
    await press("stockIn.countApply:1");
    expect(mockApply.mock.calls.map((c) => c[0])).toEqual(["p7"]);
    expect(mockApply.mock.calls[0][5]).toMatch(/^operation-/);
    expect(firstId).toBe(mockSequence);
  });
});

describe("cashiers and unsaved work", () => {
  it("a cashier is blocked from the count", async () => {
    mockRole = "cashier";
    await act(async () => tree.update(<Screen />));
    expect(allText()).toContain("stockIn.countBlocked");
    expect(inputs()).toHaveLength(0);
  });

  it("leaving with typed, unapplied quantities asks first; applied lines do not", async () => {
    mockLowStock.mockResolvedValue([mockProduct("a")]);
    await press("stockIn.countLowStock");
    const leave = () => {
      const event = { preventDefault: jest.fn(), data: { action: {} } };
      mockListeners.forEach((l) => l(event));
      return event.preventDefault.mock.calls.length > 0;
    };
    expect(leave()).toBe(false);
    await type(0, "4");
    expect(leave()).toBe(true);
    await press("stockIn.countApply:1");
    expect(leave()).toBe(false);
  });
});

describe("USB scanner on web", () => {
  type Handler = (event: Record<string, unknown>) => void;
  let handlers: Handler[] = [];
  let clock = 0;

  beforeEach(async () => {
    handlers = [];
    clock = 500_000;
    jest.replaceProperty(Platform, "OS", "web");
    (global as unknown as { document: unknown }).document = {
      addEventListener: (_t: string, h: Handler) => handlers.push(h),
      removeEventListener: (_t: string, h: Handler) => {
        handlers = handlers.filter((x) => x !== h);
      },
    };
    // Remount so the wedge registers on the fake document.
    await act(async () => tree.unmount());
    await act(async () => {
      tree = create(<Screen />);
    });
    mockLowStock.mockResolvedValue([mockProduct("milk", { barcode: "6111000000000" })]);
    await press("stockIn.countLowStock");
  });
  afterEach(async () => {
    await act(async () => tree.unmount());
    jest.restoreAllMocks();
    delete (global as unknown as { document?: unknown }).document;
  });

  const keystroke = async (k: string, field: { value: string }, gap: number) => {
    clock += gap;
    jest.spyOn(Date, "now").mockReturnValue(clock);
    const event = {
      key: k,
      target: field,
      repeat: false,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    };
    await act(async () => handlers.forEach((h) => h(event)));
    if (!event.preventDefault.mock.calls.length && k.length === 1) {
      field.value += k;
      await act(async () => inputs()[0].props.onChangeText(field.value));
    }
    return event;
  };

  it("a barcode scanned while a quantity box has focus never becomes the quantity", async () => {
    await type(0, "5");
    const field = {
      tagName: "INPUT",
      value: "5",
      dispatchEvent: jest.fn(() => {
        inputs()[0].props.onChangeText(field.value);
        return true;
      }),
    };
    let enter!: Awaited<ReturnType<typeof keystroke>>;
    for (const [i, k] of [..."6111000000000"].entries()) await keystroke(k, field, i ? 8 : 300);
    enter = await keystroke("Enter", field, 8);

    expect(field.value).toBe("5");
    expect(inputs()[0].props.value).toBe("5");
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(enter.stopPropagation).toHaveBeenCalled();
    // The scan found the existing line: still one line, no apply was triggered.
    expect(inputs()).toHaveLength(1);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
    expect(allText()).toContain("stockIn.countFound");
  });

  it("an unknown barcode shows the existing message and adds nothing", async () => {
    const field = {
      tagName: "INPUT",
      value: "",
      dispatchEvent: jest.fn(() => {
        inputs()[0].props.onChangeText(field.value);
        return true;
      }),
    };
    for (const [i, k] of [..."9999999999999"].entries()) await keystroke(k, field, i ? 8 : 300);
    await keystroke("Enter", field, 8);
    expect(allText()).toContain("stockIn.countUnknown");
    expect(inputs()).toHaveLength(1);
    expect(inputs()[0].props.value).toBe("");
  });
});

describe("stock is re-read before applying", () => {
  beforeEach(async () => {
    mockLowStock.mockResolvedValue([mockProduct("a")]);
    await press("stockIn.countLowStock");
  });

  it("counts against current stock: 2 sold since loading, shelf count 8 -> no change", async () => {
    mockStock.mockResolvedValue(new Map([["a", 8]]));
    await type(0, "8");
    await press("stockIn.countApply:1");
    expect(mockStock).toHaveBeenCalledWith(["a"], true);
    expect(mockApply.mock.calls[0].slice(0, 3)).toEqual(["a", 8, 8]);
    expect(mockConfirm.mock.calls[0][1]).toContain("8 → 8");
  });

  it("a failed re-read applies nothing and says so", async () => {
    mockStock.mockRejectedValue(new Error("offline"));
    await type(0, "8");
    await press("stockIn.countApply:1");
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(allText()).toContain("stockIn.countStaleError");
  });

  it("a product missing from the re-read applies nothing", async () => {
    mockStock.mockResolvedValue(new Map());
    await type(0, "8");
    await press("stockIn.countApply:1");
    expect(mockApply).not.toHaveBeenCalled();
    expect(allText()).toContain("stockIn.countStaleError");
  });

  it("a retry keeps its frozen quantity and does not re-read", async () => {
    mockStock.mockResolvedValue(new Map([["a", 10]]));
    mockApply.mockRejectedValueOnce(new Error("lost"));
    await type(0, "7");
    await press("stockIn.countApply:1");
    const first = mockApply.mock.calls[0];
    mockStock.mockClear().mockResolvedValue(new Map([["a", 3]]));
    await press("stockIn.countApply:1");
    expect(mockStock).not.toHaveBeenCalled();
    expect(mockApply.mock.calls[1]).toEqual(first);
    expect(first[2]).toBe(10);
  });
});

describe("invalid counts", () => {
  beforeEach(async () => {
    mockLowStock.mockResolvedValue([mockProduct("a")]);
    await press("stockIn.countLowStock");
  });

  it.each(["-5", "abc", "5abc", "5-3"])(
    "%s is not a count: message shown, never applied",
    async (text) => {
      await type(0, text);
      expect(allText()).toContain("stockIn.countInvalid");
      expect(tree.root.findAllByType(BigButton).some((b) => /countApply/.test(b.props.label))).toBe(
        false
      );
      expect(allText()).toContain("stockIn.countProgress:0/1");
    }
  );

  it("a valid count shows no message", async () => {
    await type(0, "0");
    expect(allText()).not.toContain("stockIn.countInvalid");
  });
});
