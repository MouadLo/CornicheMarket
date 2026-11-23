/**
 * Settings > Customer credit (owner only): the store's default debt limit,
 * read, edited in DH and saved in centimes.
 */
import React from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import Settings from "../app/(app)/settings";
import { BigButton } from "../src/components/BigButton";
import { allTexts } from "./sales/sellTestUtils";

const mockFetchLimit = jest.fn();
const mockUpdateLimit = jest.fn(async (..._a: unknown[]) => {});
let mockRole = "owner";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: object) => (o ? `${k}${JSON.stringify(o)}` : k),
    i18n: { language: "fr" },
  }),
}));
jest.mock("../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({
    session: { user: { id: "me", email: "o@x.ma" } },
    profile: { full_name: "Salma", role: mockRole },
  }),
}));
jest.mock("../src/lib/auth/useSignOut", () => ({ useSignOut: () => jest.fn() }));
jest.mock("../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("../src/i18n", () => ({ changeLanguage: jest.fn() }));
jest.mock("../src/lib/backup/export", () => ({
  exportEverything: jest.fn(),
  exportProducts: jest.fn(),
  exportPurchases: jest.fn(),
  exportSales: jest.fn(),
  getLastBackupTime: jest.fn(async () => new Date()),
}));
jest.mock("../src/lib/reports/queries", () => ({
  fetchStoreTimezone: jest.fn(async () => "UTC"),
  updateStoreTimezone: jest.fn(),
}));
jest.mock("../src/lib/sales/queries", () => ({
  fetchDiscountLimits: async () => ({ percent: 5, maxCents: 2000 }),
  updateDiscountLimits: jest.fn(),
  fetchStoreCreditLimit: () => mockFetchLimit(),
  updateStoreCreditLimit: (...a: unknown[]) => mockUpdateLimit(...a),
}));
jest.mock("../src/lib/competitors/queries", () => ({
  // Never settles: the section stays on "loading" and adds no field to these tests.
  fetchStoreMinMargin: () => new Promise(() => {}),
  updateStoreMinMargin: jest.fn(),
}));
jest.mock("../src/lib/auth/inviteCashier", () => ({ inviteCashier: jest.fn() }));
jest.mock("../src/lib/auth/staff", () => ({
  ...jest.requireActual("../src/lib/auth/staff"),
  fetchStaff: async () => [],
}));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});
jest.mock("../src/lib/dialog/store", () => ({ confirm: jest.fn() }));

let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<Settings />);
  });
};
const field = () =>
  tree.root
    .findAllByType(TextInput)
    .find((n) => n.props.accessibilityLabel === "settings.creditLimit");
const saveButton = () =>
  tree.root.findAllByType(BigButton).find((b) => b.props.label === "settings.creditSave")!;

beforeEach(() => {
  mockRole = "owner";
  mockFetchLimit.mockReset();
  mockFetchLimit.mockResolvedValue(30000);
  mockUpdateLimit.mockClear();
});
afterEach(() => act(() => tree.unmount()));

describe("Settings: customer credit limit", () => {
  it("shows the saved default in DH", async () => {
    await render();
    expect(allTexts(tree.root)).toContain("settings.creditTitle");
    expect(field()!.props.value).toBe("300.00");
  });

  it("saves what the owner typed, in centimes", async () => {
    await render();
    await act(async () => field()!.props.onChangeText("450"));
    await act(async () => saveButton().props.onPress());
    expect(mockUpdateLimit).toHaveBeenCalledWith(45000);
    expect(allTexts(tree.root)).toContain("settings.creditSaved");
  });

  it("0 is a valid default (no credit unless a customer has their own limit)", async () => {
    await render();
    await act(async () => field()!.props.onChangeText("0"));
    await act(async () => saveButton().props.onPress());
    expect(mockUpdateLimit).toHaveBeenCalledWith(0);
  });

  it("refuses a value that is not an amount, and writes nothing", async () => {
    await render();
    await act(async () => field()!.props.onChangeText("abc"));
    await act(async () => saveButton().props.onPress());
    expect(mockUpdateLimit).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain("settings.creditInvalid");
  });

  it("a failed read says so and offers Retry instead of showing a made-up default", async () => {
    mockFetchLimit.mockRejectedValue(new TypeError("Failed to fetch"));
    await render();
    expect(allTexts(tree.root)).toContain("settings.creditLoadError");
    expect(field()).toBeUndefined();
  });

  it("a cashier never sees the section", async () => {
    mockRole = "cashier";
    await render();
    expect(allTexts(tree.root)).not.toContain("settings.creditTitle");
    expect(field()).toBeUndefined();
    expect(mockFetchLimit).not.toHaveBeenCalled();
  });
});
