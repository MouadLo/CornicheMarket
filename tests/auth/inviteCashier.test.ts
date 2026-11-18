import { inviteCashier } from "../../src/lib/auth/inviteCashier";

const mockInvoke = jest.fn();
jest.mock("../../src/lib/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
}));

beforeEach(() => mockInvoke.mockReset());

it("sends the email and full name to the invite-cashier function", async () => {
  mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
  await inviteCashier("a@x.ma", "Amina");
  expect(mockInvoke).toHaveBeenCalledWith("invite-cashier", {
    body: { email: "a@x.ma", full_name: "Amina" },
  });
});

it("reads the refusal out of the response body so it can be mapped", async () => {
  mockInvoke.mockResolvedValue({
    data: null,
    error: {
      message: "Edge Function returned a non-2xx status code",
      context: { json: async () => ({ error: "Only an owner can invite cashiers" }) },
    },
  });
  await expect(inviteCashier("a@x.ma", "Amina")).rejects.toThrow(
    "Only an owner can invite cashiers"
  );
});

it("falls back to the generic message when the body is not readable", async () => {
  mockInvoke.mockResolvedValue({
    data: null,
    error: {
      message: "Failed to send a request to the Edge Function",
      context: {
        json: async () => {
          throw new Error("not json");
        },
      },
    },
  });
  await expect(inviteCashier("a@x.ma", "Amina")).rejects.toThrow("Failed to send a request");
});

it("treats an error in a 200 answer as a failure", async () => {
  mockInvoke.mockResolvedValue({
    data: { error: "email and full_name are required" },
    error: null,
  });
  await expect(inviteCashier("", "")).rejects.toThrow("required");
});
