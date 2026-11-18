import {
  deactivationAwareFetch,
  isDeactivatedError,
  onDeactivated,
} from "../../src/lib/auth/deactivated";

describe("isDeactivatedError", () => {
  it.each([
    [{ code: "PT403", message: "Account deactivated" }],
    [{ code: "PT403", message: "x" }],
    [new Error("Account deactivated")],
    [{ code: "user_banned", message: "User is banned" }],
    ["User is banned"],
    ["account_deactivated"],
  ])("recognises %j", (error) => {
    expect(isDeactivatedError(error)).toBe(true);
  });

  it.each([
    [null],
    [undefined],
    [new Error("Invalid login credentials")],
    [{ code: "42501", message: "permission denied" }],
    [new Error("Failed to fetch")],
    [{ code: "PT401", message: "x" }],
  ])("ignores %j", (error) => {
    expect(isDeactivatedError(error)).toBe(false);
  });
});

describe("deactivationAwareFetch", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const respond = (status: number, body: unknown) => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify(body), { status })) as never;
  };

  it("reports a PT403 response once and still returns it unread", async () => {
    respond(403, { code: "PT403", message: "Account deactivated" });
    const seen = jest.fn();
    const off = onDeactivated(seen);
    const response = await deactivationAwareFetch("https://x.test/rest/v1/sales");
    off();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "PT403", message: "Account deactivated" });
  });

  it("reports the Edge Function wording as well", async () => {
    respond(403, { error: "Account deactivated", code: "PT403" });
    const seen = jest.fn();
    const off = onDeactivated(seen);
    await deactivationAwareFetch("https://x.test/functions/v1/invite-cashier");
    off();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("ignores other 403s, other statuses and bodies that are not JSON", async () => {
    const seen = jest.fn();
    const off = onDeactivated(seen);
    respond(403, { code: "42501", message: "permission denied for table sales" });
    await deactivationAwareFetch("https://x.test/a");
    respond(200, { code: "PT403" });
    await deactivationAwareFetch("https://x.test/b");
    global.fetch = jest.fn(async () => new Response("<html>", { status: 403 })) as never;
    await deactivationAwareFetch("https://x.test/c");
    off();
    expect(seen).not.toHaveBeenCalled();
  });
});
