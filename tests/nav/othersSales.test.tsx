import React from "react";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import { OthersSalesList } from "../../src/components/shell/OthersSalesList";
import { SyncMenu } from "../../src/components/shell/SyncMenu";
import {
  __resetForTests,
  getState,
  registerHost,
  resolveConfirm,
} from "../../src/lib/dialog/store";

const mockList = jest.fn();
const mockNames = jest.fn();
const mockRecover = jest.fn();

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k),
    i18n: { language: "fr" },
  }),
}));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});
jest.mock("../../src/lib/sales/offlineQueue", () => ({
  listSalesOfOthers: (...a: unknown[]) => mockList(...a),
  listStuckSales: async () => [],
  retryStuckSale: jest.fn(),
  dismissStuckSale: jest.fn(),
}));
jest.mock("../../src/lib/sales/queries", () => ({
  fetchCashierNames: (...a: unknown[]) => mockNames(...a),
}));
jest.mock("../../src/lib/sales/recovery", () => ({
  recoverQueuedSale: (...a: unknown[]) => mockRecover(...a),
}));

const texts = (n: ReactTestInstance) =>
  n.findAll((x) => (x.type as unknown) === "Text").map((x) => x.children.join(""));
const sale = (id: string, cashier: string | undefined) => ({
  id,
  cashier_id: cashier,
  total_cents: 1250,
  created_at: "2026-11-01T10:00:00Z",
});
const mounted: ReturnType<typeof create>[] = [];
async function render(el: React.ReactElement) {
  let r!: ReturnType<typeof create>;
  await act(async () => {
    r = create(el);
  });
  mounted.push(r);
  return r;
}
const pressText = async (r: ReturnType<typeof create>, label: string) => {
  const hits = r.root.findAll(
    (n) => typeof n.props.onPress === "function" && texts(n).includes(label)
  );
  const smallest = hits.reduce((a, b) =>
    a.findAll(() => true).length <= b.findAll(() => true).length ? a : b
  );
  // Don't await the handler: it waits for the confirm dialog, which the test answers next.
  await act(async () => {
    void smallest.props.onPress();
  });
};

let offHost: () => void;
beforeEach(() => {
  __resetForTests();
  offHost = registerHost();
  mockList.mockReset();
  mockNames.mockReset();
  mockRecover.mockReset();
  mockNames.mockResolvedValue({ "user-a": "Salma" });
});
afterEach(() => {
  act(() => mounted.splice(0).forEach((r) => r.unmount()));
  offHost();
  __resetForTests();
});

describe("the owner's recovery list", () => {
  it("lists other users' sales by name, and legacy sales as an unknown cashier", async () => {
    mockList.mockResolvedValue([sale("s1", "user-a"), sale("old", undefined)]);
    const r = await render(<OthersSalesList userId="owner" onChanged={() => {}} />);
    const all = texts(r.root);
    expect(mockList).toHaveBeenCalledWith("owner");
    expect(all.join("|")).toContain("Salma");
    expect(all).toContain("shell.recoverUnknownCashier");
    expect(all).toContain('shell.othersTitle{"count":2}');
  });

  it("renders nothing when there is nothing left on the device", async () => {
    mockList.mockResolvedValue([]);
    const r = await render(<OthersSalesList userId="owner" onChanged={() => {}} />);
    expect(r.toJSON()).toBeNull();
  });

  it("asks first, then recovers the sale and refreshes the list", async () => {
    const onChanged = jest.fn();
    mockList.mockResolvedValueOnce([sale("s1", "user-a")]).mockResolvedValue([]);
    mockRecover.mockResolvedValue("recovered");
    const r = await render(<OthersSalesList userId="owner" onChanged={onChanged} />);

    await pressText(r, "shell.recoverButton");
    // The confirm dialog is up: nothing recovered yet.
    expect(mockRecover).not.toHaveBeenCalled();
    expect(getState().confirm?.message).toContain("Salma");
    await act(async () => resolveConfirm(getState().confirm!.id, true));

    expect(mockRecover).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1", cashier_id: "user-a" })
    );
    expect(onChanged).toHaveBeenCalled();
    expect(r.toJSON()).toBeNull(); // gone from the list
  });

  it("declining the confirmation recovers nothing", async () => {
    mockList.mockResolvedValue([sale("s1", "user-a")]);
    const r = await render(<OthersSalesList userId="owner" onChanged={() => {}} />);
    await pressText(r, "shell.recoverButton");
    await act(async () => resolveConfirm(getState().confirm!.id, false));
    expect(mockRecover).not.toHaveBeenCalled();
  });

  it("a failed recovery keeps the sale listed, with an error toast", async () => {
    mockList.mockResolvedValue([sale("s1", "user-a")]);
    mockRecover.mockRejectedValue(new Error("Failed to fetch"));
    const r = await render(<OthersSalesList userId="owner" onChanged={() => {}} />);
    await pressText(r, "shell.recoverButton");
    await act(async () => resolveConfirm(getState().confirm!.id, true));
    expect(getState().toast?.text).toBe("shell.recoverError");
    expect(texts(r.root)).toContain("shell.recoverButton");
  });
});

describe("the sync menu", () => {
  const state = { online: true, pending: 0, others: 2, stuck: 0, syncing: false, lastError: null };

  it("an owner sees the recovery list", async () => {
    mockList.mockResolvedValue([sale("s1", "user-a")]);
    const r = await render(
      <SyncMenu
        visible
        onClose={() => {}}
        state={state}
        isOwner
        userId="owner"
        onSyncNow={async () => {}}
        onChanged={() => {}}
      />
    );
    expect(texts(r.root)).toContain("shell.recoverButton");
  });

  it("a cashier only gets a notice: no list, no way to send or recover someone else's sale", async () => {
    mockList.mockResolvedValue([sale("s1", "user-a")]);
    const r = await render(
      <SyncMenu
        visible
        onClose={() => {}}
        state={state}
        isOwner={false}
        userId="user-b"
        onSyncNow={async () => {}}
        onChanged={() => {}}
      />
    );
    const all = texts(r.root);
    expect(all).toContain('shell.othersCashierNotice{"count":2}');
    expect(all).not.toContain("shell.recoverButton");
    expect(mockList).not.toHaveBeenCalled();
  });

  it("is not reported as 'all synced' while another user's sales are waiting", async () => {
    mockList.mockResolvedValue([]);
    const r = await render(
      <SyncMenu
        visible
        onClose={() => {}}
        state={state}
        isOwner={false}
        userId="user-b"
        onSyncNow={async () => {}}
        onChanged={() => {}}
      />
    );
    expect(texts(r.root)).not.toContain("shell.syncAllDone");
  });
});
