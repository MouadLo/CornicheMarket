/**
 * Signing out with sales still waiting would strand them (only their own user's
 * session may send them, audit C05). The sign-out button warns first, never
 * deletes them, and signs out straight away when nothing is waiting.
 */
import React from "react";
import { act, create } from "react-test-renderer";

import { useSignOut } from "../../src/lib/auth/useSignOut";

const mockSignOut = jest.fn(async () => {});
const mockConfirm = jest.fn();
const mockCount = jest.fn();
const mockQueue = {
  countPendingFor: (...a: unknown[]) => mockCount(...a),
  // Anything else on the queue module would be a destructive call: not provided.
};

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: object) => (o ? `${k}${JSON.stringify(o)}` : k) }),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({
    session: { user: { id: "user-a" } },
    profile: { full_name: "Salma" },
    signOut: () => mockSignOut(),
  }),
}));
jest.mock("../../src/lib/dialog/store", () => ({
  confirm: (...a: unknown[]) => mockConfirm(...a),
}));
jest.mock("../../src/lib/sales/offlineQueue", () => ({
  countPendingFor: (...a: unknown[]) => mockQueue.countPendingFor(...a),
}));

let signOut!: () => Promise<void>;
function Probe() {
  signOut = useSignOut();
  return null;
}

beforeEach(() => {
  mockSignOut.mockClear();
  mockConfirm.mockReset();
  mockCount.mockReset();
  act(() => {
    create(<Probe />);
  });
});

describe("sign-out with sales waiting to be sent", () => {
  it("signs out straight away when nothing is waiting", async () => {
    mockCount.mockResolvedValue(0);
    await signOut();
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("warns first, naming the count and the user, and says they stay on the device", async () => {
    mockCount.mockResolvedValue(3);
    mockConfirm.mockResolvedValue(false);
    await signOut();
    expect(mockCount).toHaveBeenCalledWith("user-a");
    const options = mockConfirm.mock.calls[0][0];
    expect(options.tone).toBe("danger");
    expect(options.message).toContain('"count":3');
    expect(options.message).toContain("Salma");
  });

  it("staying signed in does not sign out", async () => {
    mockCount.mockResolvedValue(2);
    mockConfirm.mockResolvedValue(false);
    await signOut();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("confirming signs out, and the queue is never touched (only counted)", async () => {
    mockCount.mockResolvedValue(2);
    mockConfirm.mockResolvedValue(true);
    await signOut();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockCount).toHaveBeenCalledTimes(1);
  });

  it("if the queue cannot be read, it asks rather than assuming nothing is waiting", async () => {
    mockCount.mockRejectedValue(new Error("Unreadable sales storage"));
    mockConfirm.mockResolvedValue(false);
    await signOut();
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm.mock.calls[0][0].message).toBe("shell.signOutPendingUnknown");
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
