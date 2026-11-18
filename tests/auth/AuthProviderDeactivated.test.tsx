/**
 * A deactivated account: the database refuses the profile fetch (PT403). That is
 * a state of its own, not a "profile error" with a Retry button, and it never
 * leaves anyone looking like an owner.
 */
import * as React from "react";
import { act, create } from "react-test-renderer";

import { AuthProvider, useAuth } from "../../src/lib/auth/AuthProvider";
import { notifyDeactivated } from "../../src/lib/auth/deactivated";

const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn((_callback: unknown) => ({
  data: { subscription: { unsubscribe: jest.fn() } },
}));
const mockSignOut = jest.fn(async (..._args: unknown[]) => ({ error: null }));
const mockSignIn = jest.fn();

jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (callback: unknown) => mockOnAuthStateChange(callback),
      signInWithPassword: (...a: unknown[]) => mockSignIn(...a),
      signOut: (...a: unknown[]) => mockSignOut(...a),
    },
    from: jest.fn(),
  },
}));

const { supabase } = jest.requireMock("../../src/lib/supabase/client") as {
  supabase: { from: jest.Mock };
};

function Probe({ onRender }: { onRender: (value: ReturnType<typeof useAuth>) => void }) {
  onRender(useAuth());
  return null;
}

const session = { access_token: "t", user: { id: "bb" } };
const profileResult = (result: { data: unknown; error: unknown }) =>
  supabase.from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ single: () => Promise.resolve(result) }) }),
  }));

async function mount() {
  const renders: ReturnType<typeof useAuth>[] = [];
  await act(async () => {
    create(
      <AuthProvider>
        <Probe onRender={(value) => renders.push(value)} />
      </AuthProvider>
    );
  });
  return renders;
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockSignOut.mockClear();
  mockSignIn.mockReset();
  mockGetSession.mockResolvedValue({ data: { session } });
});

describe("AuthProvider: deactivated account", () => {
  it("turns the refused profile fetch into `deactivated`, not a profile error", async () => {
    profileResult({
      data: null,
      error: { code: "PT403", message: "Account deactivated" },
    });
    const renders = await mount();
    expect(renders.at(-1)).toMatchObject({
      loading: false,
      deactivated: true,
      profile: null,
      profileError: null,
    });
  });

  it("still reports an ordinary profile failure as a profile error", async () => {
    profileResult({ data: null, error: { message: "Failed to fetch" } });
    const renders = await mount();
    expect(renders.at(-1)).toMatchObject({
      deactivated: false,
      profile: null,
      profileError: "Failed to fetch",
    });
  });

  it("never grants a profile (so no owner access) once a later request finds out", async () => {
    profileResult({ data: { id: "bb", full_name: "Amina", role: "owner" }, error: null });
    const renders = await mount();
    expect(renders.at(-1)).toMatchObject({ deactivated: false, profile: { role: "owner" } });
    await act(async () => {
      notifyDeactivated();
    });
    expect(renders.at(-1)).toMatchObject({ deactivated: true, profile: null });
  });

  it("ignores the signal when nobody is signed in", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const renders = await mount();
    await act(async () => {
      notifyDeactivated();
    });
    expect(renders.at(-1)?.deactivated).toBe(false);
  });

  it("signs out of this device only, without calling the server session", async () => {
    profileResult({ data: null, error: { code: "PT403", message: "Account deactivated" } });
    const renders = await mount();
    await act(async () => {
      await renders.at(-1)!.signOut();
    });
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("clears the state when the next person signs in", async () => {
    profileResult({ data: null, error: { code: "PT403", message: "Account deactivated" } });
    const renders = await mount();
    expect(renders.at(-1)?.deactivated).toBe(true);
    profileResult({ data: { id: "aa", full_name: "Owner", role: "owner" }, error: null });
    const emit = mockOnAuthStateChange.mock.calls.at(-1)![0] as (e: string, s: unknown) => void;
    await act(async () => {
      emit("SIGNED_IN", { access_token: "t2", user: { id: "aa" } });
    });
    expect(renders.at(-1)).toMatchObject({ deactivated: false, profile: { role: "owner" } });
  });

  it("signIn maps a banned user to a stable message", async () => {
    profileResult({ data: null, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const renders = await mount();
    mockSignIn.mockResolvedValue({ error: { code: "user_banned", message: "User is banned" } });
    let result: { error: string | null } | undefined;
    await act(async () => {
      result = await renders.at(-1)!.signIn("a@b.c", "x");
    });
    expect(result).toEqual({ error: "Account deactivated" });
    mockSignIn.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    await act(async () => {
      result = await renders.at(-1)!.signIn("a@b.c", "x");
    });
    expect(result).toEqual({ error: "Invalid login credentials" });
  });
});
