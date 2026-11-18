import {
  deactivateStaff,
  fetchStaff,
  reactivateStaff,
  resendStaffInvite,
  staffActions,
  staffStatus,
  toStaffMember,
  type StaffMember,
} from "../../src/lib/auth/staff";

const mockRpc = jest.fn();
const mockInvoke = jest.fn();
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
  },
}));

const row = (over: Partial<Parameters<typeof toStaffMember>[0]> = {}) =>
  toStaffMember({
    id: "u1",
    full_name: "Amina",
    role: "cashier",
    email: "amina@x.ma",
    invite_accepted: true,
    last_sign_in_at: "2026-05-01T10:00:00Z",
    deactivated_at: null,
    ...over,
  });

describe("staffStatus", () => {
  it("is active once the invite was accepted", () => {
    expect(staffStatus({ deactivatedAt: null, inviteAccepted: true })).toBe("active");
  });
  it("is pending until the invite is accepted", () => {
    expect(staffStatus({ deactivatedAt: null, inviteAccepted: false })).toBe("pending");
  });
  it("deactivated wins over both", () => {
    expect(staffStatus({ deactivatedAt: "2026-01-01", inviteAccepted: true })).toBe("deactivated");
    expect(staffStatus({ deactivatedAt: "2026-01-01", inviteAccepted: false })).toBe("deactivated");
  });
});

describe("staffActions", () => {
  const m = (over: Partial<StaffMember>): StaffMember => ({ ...row(), ...over });
  it("offers Deactivate for an active cashier", () => {
    expect(staffActions(m({}), "owner")).toEqual(["deactivate"]);
  });
  it("offers Resend invite and Deactivate for a pending one", () => {
    expect(staffActions(m({ status: "pending", inviteAccepted: false }), "owner")).toEqual([
      "resend_invite",
      "deactivate",
    ]);
  });
  it("offers only Reactivate for a deactivated one", () => {
    expect(staffActions(m({ status: "deactivated" }), "owner")).toEqual(["reactivate"]);
  });
  it("offers nothing on an owner", () => {
    expect(staffActions(m({ role: "owner" }), "other")).toEqual([]);
  });
  it("offers nothing on yourself", () => {
    expect(staffActions(m({ id: "me" }), "me")).toEqual([]);
  });
  it("still lets the owner act when the own id is unknown", () => {
    expect(staffActions(m({}), null)).toEqual(["deactivate"]);
  });
});

describe("fetchStaff", () => {
  it("maps the rows and an empty email", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: "u1",
          full_name: "Amina",
          role: "cashier",
          email: null,
          invite_accepted: false,
          last_sign_in_at: null,
          deactivated_at: null,
        },
      ],
      error: null,
    });
    const staff = await fetchStaff();
    expect(mockRpc).toHaveBeenCalledWith("list_staff");
    expect(staff[0]).toMatchObject({ email: "", status: "pending", fullName: "Amina" });
  });
  it("throws the server's message, to be mapped by errorKey", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Only an owner can list staff" } });
    await expect(fetchStaff()).rejects.toThrow("Only an owner can list staff");
  });
});

describe("manage-staff calls", () => {
  beforeEach(() => mockInvoke.mockReset());

  it.each([
    [deactivateStaff, "deactivate"],
    [reactivateStaff, "reactivate"],
    [resendStaffInvite, "resend_invite"],
  ])("sends the action and the user id", async (fn, action) => {
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
    await fn("u1");
    expect(mockInvoke).toHaveBeenCalledWith("manage-staff", {
      body: { action, user_id: "u1" },
    });
  });

  it("reads the body of a non-2xx answer, so a partial failure is recognised", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: { json: async () => ({ error: "ban_failed", partial: true }) },
      },
    });
    await expect(deactivateStaff("u1")).rejects.toThrow("ban_failed");
  });

  it("falls back to the generic message when the body is not JSON", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: {
          json: async () => {
            throw new Error("nope");
          },
        },
      },
    });
    await expect(deactivateStaff("u1")).rejects.toThrow("non-2xx");
  });
});
