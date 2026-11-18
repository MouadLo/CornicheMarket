/**
 * A cashier cannot void a sale: they ask, and the owner decides (C12).
 * Pins: the ask flow (a reason is required, "other" needs a note), the status
 * badges on the history rows, and the owner's approve (asks first) / refuse.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SalesHistory from "../../app/(app)/sell/history";
import { VoidRequestsPanel } from "../../src/components/shell/VoidRequestsPanel";
import {
  describeVoidRequestError,
  latestRequestBySale,
  voidRequestErrorKey,
  voidRequestValid,
} from "../../src/lib/sales/voidRequests";
import { allTexts, pressableByText } from "./sellTestUtils";

const mockRequestVoid = jest.fn(async (..._a: unknown[]) => "req-1");
const mockFetchMine = jest.fn(async () => [] as unknown[]);
const mockFetchPending = jest.fn(async () => [] as unknown[]);
const mockDecide = jest.fn(async (..._a: unknown[]) => {});
const mockConfirm = jest.fn(async (..._a: unknown[]) => true);
const mockToast = jest.fn();
let mockRole: "owner" | "cashier" = "cashier";

const mockT = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "cashier-1", role: mockRole } }),
}));
jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("../../src/lib/sales/queries", () => ({
  fetchRecentSales: async () => [
    {
      id: "s-plain",
      created_at: "2026-11-01T10:00:00.000Z",
      payment_method: "cash",
      total_cents: 1450,
      discount_cents: 0,
      customer_id: null,
      cashier_id: "cashier-1",
      voided_at: null,
      void_reason: null,
    },
    {
      id: "s-pending",
      created_at: "2026-11-01T11:00:00.000Z",
      payment_method: "cash",
      total_cents: 500,
      discount_cents: 0,
      customer_id: null,
      cashier_id: "cashier-1",
      voided_at: null,
      void_reason: null,
    },
    {
      id: "s-refused",
      created_at: "2026-11-01T12:00:00.000Z",
      payment_method: "card",
      total_cents: 700,
      discount_cents: 0,
      customer_id: null,
      cashier_id: "cashier-1",
      voided_at: null,
      void_reason: null,
    },
  ],
  voidSale: jest.fn(),
}));
jest.mock("../../src/lib/sales/voidRequests", () => ({
  ...jest.requireActual("../../src/lib/sales/voidRequests"),
  requestVoid: (...a: unknown[]) => mockRequestVoid(...a),
  fetchMyVoidRequests: () => mockFetchMine(),
  fetchPendingVoidRequests: () => mockFetchPending(),
  decideVoidRequest: (...a: unknown[]) => mockDecide(...a),
}));
jest.mock("../../src/lib/dialog/store", () => ({
  confirm: (...a: unknown[]) => mockConfirm(...a),
  showToast: (...a: unknown[]) => mockToast(...a),
}));

let tree: ReactTestRenderer;
beforeEach(() => {
  mockRole = "cashier";
  mockRequestVoid.mockClear();
  mockDecide.mockClear();
  mockConfirm.mockClear();
  mockConfirm.mockResolvedValue(true);
  mockToast.mockClear();
  mockFetchMine.mockResolvedValue([]);
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
  tree = undefined as unknown as ReactTestRenderer;
});

async function renderHistory() {
  await act(async () => {
    tree = create(<SalesHistory />);
  });
}
const press = (label: string, index = 0) => {
  const all = tree.root
    .findAll((n) => typeof n.props.onPress === "function" && n.type !== undefined)
    .filter((n) => allTextsOf(n).join("") === label);
  return act(async () => all[index].props.onPress());
};
const allTextsOf = (n: import("react-test-renderer").ReactTestInstance) => allTexts(n);

describe("pure helpers", () => {
  it("a reason is required and 'other' needs a note", () => {
    expect(voidRequestValid(null, "")).toBe(false);
    expect(voidRequestValid("wrong_item", "")).toBe(true);
    expect(voidRequestValid("other", "   ")).toBe(false);
    expect(voidRequestValid("other", "left without paying")).toBe(true);
  });

  it("maps the database messages to translated keys", () => {
    expect(voidRequestErrorKey("The day is closed")).toBe("sell.voidErrDayClosed");
    expect(voidRequestErrorKey("A void request is already pending for this sale")).toBe(
      "sell.voidErrPending"
    );
    expect(voidRequestErrorKey("You can only ask about your own sales")).toBe(
      "sell.voidErrNotYours"
    );
    expect(voidRequestErrorKey("something unexpected")).toBe("sell.voidErrGeneric");
    expect(describeVoidRequestError(new Error("The day is closed"), (k) => `<${k}>`)).toBe(
      "<sell.voidErrDayClosed>"
    );
  });

  it("keeps the newest request per sale", () => {
    const mk = (id: string, status: "pending" | "refused") => ({
      id,
      saleId: "s",
      status,
      reasonCode: "wrong_item" as const,
      note: null,
      refusalNote: null,
      requestedAt: "",
    });
    expect(latestRequestBySale([mk("new", "pending"), mk("old", "refused")]).get("s")?.id).toBe(
      "new"
    );
  });
});

describe("cashier: asking the owner", () => {
  it("replaces the dead-end note with an ask button, and offers no direct void", async () => {
    await renderHistory();
    const texts = allTexts(tree.root);
    expect(texts).toContain("sell.askVoid");
    expect(texts).not.toContain("sell.ownerOnlyVoid");
    expect(texts).not.toContain("sell.voidRefund");
    expect(texts).not.toContain("sell.voidAndRestore");
  });

  it("needs a reason before it can send", async () => {
    await renderHistory();
    await press("sell.askVoid");
    await act(async () => {
      pressableByText(tree.root, "sell.voidRequestSend").props.onPress();
    });
    // The disabled button must not send anything.
    expect(mockRequestVoid).not.toHaveBeenCalled();
    const send = pressableByText(tree.root, "sell.voidRequestSend");
    expect(send.props.disabled).toBe(true);
  });

  it("sends the chosen reason to requestVoid", async () => {
    await renderHistory();
    await press("sell.askVoid");
    await act(async () => pressableByText(tree.root, "sell.voidReasonWrongItem").props.onPress());
    await act(async () => pressableByText(tree.root, "sell.voidRequestSend").props.onPress());
    expect(mockRequestVoid).toHaveBeenCalledWith("s-plain", "wrong_item", "");
  });

  it("'other' shows a note field and refuses to send without a note", async () => {
    await renderHistory();
    await press("sell.askVoid");
    expect(tree.root.findAll((n) => n.props.placeholder === "sell.voidRequestNote")).toHaveLength(
      0
    );
    await act(async () => pressableByText(tree.root, "sell.voidReasonOther").props.onPress());
    const input = tree.root.findAll(
      (n) =>
        n.props.placeholder === "sell.voidRequestNote" && typeof n.props.onChangeText === "function"
    )[0];
    expect(pressableByText(tree.root, "sell.voidRequestSend").props.disabled).toBe(true);
    await act(async () => input.props.onChangeText("customer left"));
    expect(pressableByText(tree.root, "sell.voidRequestSend").props.disabled).toBe(false);
    await act(async () => pressableByText(tree.root, "sell.voidRequestSend").props.onPress());
    expect(mockRequestVoid).toHaveBeenCalledWith("s-plain", "other", "customer left");
  });

  it("shows a translated error when the server refuses", async () => {
    mockRequestVoid.mockRejectedValueOnce(new Error("The day is closed"));
    await renderHistory();
    await press("sell.askVoid");
    await act(async () => pressableByText(tree.root, "sell.voidReasonWrongItem").props.onPress());
    await act(async () => pressableByText(tree.root, "sell.voidRequestSend").props.onPress());
    expect(allTexts(tree.root)).toContain("sell.voidErrDayClosed");
  });

  it("shows a status badge: pending, or refused with the owner's note", async () => {
    mockFetchMine.mockResolvedValue([
      {
        id: "r1",
        saleId: "s-pending",
        status: "pending",
        reasonCode: "wrong_item",
        note: null,
        refusalNote: null,
        requestedAt: "2026-11-01T11:05:00Z",
      },
      {
        id: "r2",
        saleId: "s-refused",
        status: "refused",
        reasonCode: "other",
        note: "x",
        refusalNote: "Keep it",
        requestedAt: "2026-11-01T12:05:00Z",
      },
    ]);
    await renderHistory();
    const texts = allTexts(tree.root);
    expect(texts).toContain("sell.voidRequested");
    expect(texts).toContain("sell.voidRefused");
    expect(texts).toContain('sell.voidRefusedNote:{"note":"Keep it"}');
    // Pending: no second ask button for that sale (plain + refused still can ask).
    expect(texts.filter((x) => x === "sell.askVoid")).toHaveLength(2);
  });
});

describe("owner: approve or refuse", () => {
  const pending = {
    id: "req-1",
    saleId: "s1",
    reasonCode: "wrong_quantity",
    note: "rang 3 instead of 2",
    requestedAt: "2026-11-01T10:05:00",
    cashierName: "Salma",
    totalCents: 3450,
    occurredAt: "2026-11-01T10:00:00",
    paymentMethod: "cash",
    lines: [{ name: "Lait", quantity: 3, lineTotalCents: 3450 }],
  };
  const onChanged = jest.fn();

  async function renderPanel() {
    mockFetchPending.mockResolvedValue([pending]);
    onChanged.mockClear();
    await act(async () => {
      tree = create(<VoidRequestsPanel visible onClose={() => {}} onChanged={onChanged} />);
    });
  }

  it("lists the request with its sale, cashier, reason and note", async () => {
    await renderPanel();
    const all = allTexts(tree.root).join("|");
    expect(all).toContain("shell.voidReasonLine");
    expect(all).toContain("rang 3 instead of 2");
    expect(all).toContain("Lait");
    expect(all).toContain("Salma");
  });

  it("approve asks for a danger confirmation first, then decides true", async () => {
    await renderPanel();
    await act(async () => pressableByText(tree.root, "shell.voidApprove").props.onPress());
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "danger", title: "shell.voidApproveTitle" })
    );
    expect(mockDecide).toHaveBeenCalledWith("req-1", true);
    expect(onChanged).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({ text: "shell.voidApproved" });
    expect(allTexts(tree.root)).toContain("shell.voidRequestsEmpty");
  });

  it("approve does nothing when the confirmation is declined", async () => {
    mockConfirm.mockResolvedValue(false);
    await renderPanel();
    await act(async () => pressableByText(tree.root, "shell.voidApprove").props.onPress());
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it("refuse takes an optional note and decides false", async () => {
    await renderPanel();
    await act(async () => pressableByText(tree.root, "shell.voidRefuse").props.onPress());
    const input = tree.root.findAll(
      (n) =>
        n.props.placeholder === "shell.voidRefusalNote" &&
        typeof n.props.onChangeText === "function"
    )[0];
    await act(async () => input.props.onChangeText("Keep it"));
    await act(async () => pressableByText(tree.root, "shell.voidRefuseConfirm").props.onPress());
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockDecide).toHaveBeenCalledWith("req-1", false, "Keep it");
    expect(onChanged).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({ text: "shell.voidRefused" });
  });

  it("a failed approval (day closed) keeps the request and says why", async () => {
    mockDecide.mockRejectedValueOnce(new Error("The day is closed"));
    await renderPanel();
    await act(async () => pressableByText(tree.root, "shell.voidApprove").props.onPress());
    expect(mockToast).toHaveBeenCalledWith({ text: "sell.voidErrDayClosed", tone: "info" });
  });
});
