/**
 * Settings > Staff (owner only): statuses, the actions each row gets, the
 * confirmation that says past sales are kept, partial failures, and the
 * deactivated full-screen message.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { DeactivatedScreen } from "../src/components/auth/DeactivatedScreen";
import Settings from "../app/(app)/settings";
import { allTexts, pressableByText } from "./sales/sellTestUtils";

const mockConfirm = jest.fn();
const mockFetchStaff = jest.fn();
const mockDeactivate = jest.fn(async (..._a: unknown[]) => {});
const mockReactivate = jest.fn(async (..._a: unknown[]) => {});
const mockResend = jest.fn(async (..._a: unknown[]) => {});
const mockInvite = jest.fn(async (..._a: unknown[]) => {});
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
jest.mock("../src/lib/loyalty/queries", () => ({
  fetchLoyaltySettings: async () => ({
    enabled: false,
    centsPerPoint: 1000,
    pointValueCents: 10,
    minRedeemPoints: 100,
    dailyReviewPoints: 100,
    welcomePoints: 0,
  }),
  fetchLoyaltyCategories: async () => [],
  updateLoyaltySettings: jest.fn(),
  setCategoryLoyaltyExcluded: jest.fn(),
}));
jest.mock("../src/lib/sellGrid/queries", () => ({
  fetchDiversSettings: async () => ({ maxCents: 20000, marginPercent: 20 }),
  updateDiversSettings: jest.fn(),
}));
jest.mock("../src/lib/sales/queries", () => ({
  fetchDiscountLimits: async () => ({ percent: 5, maxCents: 2000 }),
  updateDiscountLimits: jest.fn(),
}));
jest.mock("../src/lib/auth/inviteCashier", () => ({
  inviteCashier: (...a: unknown[]) => mockInvite(...a),
}));
jest.mock("../src/lib/auth/staff", () => ({
  ...jest.requireActual("../src/lib/auth/staff"),
  fetchStaff: () => mockFetchStaff(),
  deactivateStaff: (...a: unknown[]) => mockDeactivate(...a),
  reactivateStaff: (...a: unknown[]) => mockReactivate(...a),
  resendStaffInvite: (...a: unknown[]) => mockResend(...a),
}));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});
jest.mock("../src/lib/dialog/store", () => ({
  confirm: (...a: unknown[]) => mockConfirm(...a),
}));

const STAFF = [
  {
    id: "me",
    full_name: "Salma",
    role: "owner",
    email: "o@x.ma",
    invite_accepted: true,
    last_sign_in_at: "2026-05-01T10:00:00Z",
    deactivated_at: null,
  },
  {
    id: "u-active",
    full_name: "Amina",
    role: "cashier",
    email: "amina@x.ma",
    invite_accepted: true,
    last_sign_in_at: null,
    deactivated_at: null,
  },
  {
    id: "u-pending",
    full_name: "Youssef",
    role: "cashier",
    email: "youssef@x.ma",
    invite_accepted: false,
    last_sign_in_at: null,
    deactivated_at: null,
  },
  {
    id: "u-off",
    full_name: "Karim",
    role: "cashier",
    email: "karim@x.ma",
    invite_accepted: true,
    last_sign_in_at: "2026-04-01T10:00:00Z",
    deactivated_at: "2026-05-02T10:00:00Z",
  },
  {
    id: "owner2",
    full_name: "Other owner",
    role: "owner",
    email: "o2@x.ma",
    invite_accepted: true,
    last_sign_in_at: null,
    deactivated_at: null,
  },
];
const toMember = (r: (typeof STAFF)[number]) =>
  jest.requireActual("../src/lib/auth/staff").toStaffMember(r);

let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<Settings />);
  });
};
const row = (id: string) => tree.root.findByProps({ testID: `staff-${id}` });
const rowTexts = (id: string) => allTexts(row(id)).join("|");
const press = (id: string, label: string) =>
  act(async () => {
    await pressableByText(row(id), label).props.onPress();
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "owner";
  mockFetchStaff.mockResolvedValue(STAFF.map(toMember));
  mockConfirm.mockResolvedValue(true);
});
afterEach(() => act(() => tree?.unmount()));

describe("staff list", () => {
  it("shows each person's status and last sign-in", async () => {
    await render();
    expect(rowTexts("u-active")).toContain("settings.statusActive");
    expect(rowTexts("u-active")).toContain("settings.neverSignedIn");
    expect(rowTexts("u-pending")).toContain("settings.statusPending");
    expect(rowTexts("u-off")).toContain("settings.statusDeactivated");
    expect(rowTexts("u-off")).toContain("settings.lastSignIn");
  });

  it("is not shown to a cashier", async () => {
    mockRole = "cashier";
    await render();
    expect(mockFetchStaff).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ testID: "staff-u-active" })).toHaveLength(0);
  });

  it("gives no action on owners or on yourself", async () => {
    await render();
    expect(rowTexts("me")).not.toMatch(/settings\.(deactivate|reactivate|resendInvite)/);
    expect(rowTexts("owner2")).not.toMatch(/settings\.(deactivate|reactivate|resendInvite)/);
    expect(rowTexts("me")).toContain("settings.staffYou");
  });

  it("offers the right buttons per status", async () => {
    await render();
    expect(rowTexts("u-active")).toContain("settings.deactivate");
    expect(rowTexts("u-pending")).toContain("settings.resendInvite");
    expect(rowTexts("u-off")).toContain("settings.reactivate");
    expect(rowTexts("u-off")).not.toContain("settings.deactivate|");
  });

  it("shows LoadError with Retry when the list cannot be read", async () => {
    mockFetchStaff.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await render();
    expect(allTexts(tree.root).join("|")).toContain("settings.staffLoadError");
    expect(tree.root.findAllByProps({ testID: "staff-u-active" })).toHaveLength(0);
    await act(async () => {
      await pressableByText(tree.root, "common.retry").props.onPress();
    });
    expect(row("u-active")).toBeTruthy();
  });
});

describe("staff actions", () => {
  it("deactivating asks first, says past sales are kept, then calls the function", async () => {
    await render();
    await press("u-active", "settings.deactivate");
    const dialog = mockConfirm.mock.calls[0][0];
    expect(dialog.tone).toBe("danger");
    expect(dialog.message).toContain("settings.deactivateMessage");
    expect(dialog.message).toContain("Amina");
    expect(mockDeactivate).toHaveBeenCalledWith("u-active");
    expect(allTexts(tree.root).join("|")).toContain("settings.staffDeactivatedDone");
    // The list is read again afterwards.
    expect(mockFetchStaff).toHaveBeenCalledTimes(2);
  });

  it("does nothing on no", async () => {
    mockConfirm.mockResolvedValue(false);
    await render();
    await press("u-active", "settings.deactivate");
    expect(mockDeactivate).not.toHaveBeenCalled();
  });

  it("reactivates after confirming", async () => {
    await render();
    await press("u-off", "settings.reactivate");
    expect(mockReactivate).toHaveBeenCalledWith("u-off");
  });

  it("re-sends an invitation without a confirmation", async () => {
    await render();
    await press("u-pending", "settings.resendInvite");
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockResend).toHaveBeenCalledWith("u-pending");
    expect(allTexts(tree.root).join("|")).toContain("settings.inviteResent");
  });

  it("a partial failure shows a translated, retryable message next to the row", async () => {
    mockDeactivate.mockRejectedValueOnce(new Error("ban_failed"));
    await render();
    await press("u-active", "settings.deactivate");
    expect(rowTexts("u-active")).toContain("errors.staffPartial");
    expect(rowTexts("u-active")).not.toContain("ban_failed");
    // The button is still there to retry.
    expect(rowTexts("u-active")).toContain("settings.deactivate");
  });

  it("an unknown failure shows the generic message, never the server text", async () => {
    mockResend.mockRejectedValueOnce(new Error("GoTrue exploded: pq: stuff"));
    await render();
    await press("u-pending", "settings.resendInvite");
    expect(rowTexts("u-pending")).toContain("errors.generic");
    expect(rowTexts("u-pending")).not.toContain("GoTrue");
  });

  it("reloads the list after an invite", async () => {
    await render();
    const { TextInput } = jest.requireActual("react-native");
    const input = (label: string) =>
      tree.root.findAllByType(TextInput).find((n) => n.props.accessibilityLabel === label)!;
    await act(async () => {
      input("settings.fullName").props.onChangeText("New Person");
      input("settings.email").props.onChangeText("new@x.ma");
    });
    await act(async () => {
      await tree.root
        .findAll((n) => n.props.label === "settings.sendInvite" && n.props.onPress)[0]
        .props.onPress();
    });
    expect(mockInvite).toHaveBeenCalledWith("new@x.ma", "New Person");
    expect(mockFetchStaff).toHaveBeenCalledTimes(2);
  });
});

describe("DeactivatedScreen", () => {
  it("shows one translated message and a Sign out button", () => {
    const onSignOut = jest.fn();
    let screen!: ReactTestRenderer;
    act(() => {
      screen = create(<DeactivatedScreen onSignOut={onSignOut} />);
    });
    const texts = allTexts(screen.root).join("|");
    expect(texts).toContain("startup.deactivatedTitle");
    expect(texts).toContain("startup.deactivatedMessage");
    act(() => {
      pressableByText(screen.root, "startup.signOut").props.onPress();
    });
    expect(onSignOut).toHaveBeenCalledTimes(1);
    act(() => screen.unmount());
  });
});
