/**
 * Proves the loading state always resolves to something actionable.
 *
 * Before this fix, if getSession() never resolved -- a misconfigured
 * Supabase URL (e.g. a raw Postgres connection string instead of the API
 * gateway URL), the local stack not running, or a dead network -- the app
 * spun on app/index.tsx's bare ActivityIndicator forever, with no error,
 * no timeout, and no way out.
 */
import * as React from "react";
import { act, create } from "react-test-renderer";

import { AuthProvider, useAuth } from "../../src/lib/auth/AuthProvider";

// Prefixed with "mock" so Jest allows it inside the jest.mock() factory.
const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn((_callback: unknown) => ({
  data: { subscription: { unsubscribe: jest.fn() } },
}));

jest.mock("../../src/lib/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (callback: unknown) => mockOnAuthStateChange(callback),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
    },
    from: jest.fn(),
  },
}));

function Probe({ onRender }: { onRender: (value: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  onRender(auth);
  return null;
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockOnAuthStateChange.mockClear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("AuthProvider: the loading state always resolves", () => {
  it("surfaces loadTimedOut when getSession() never resolves", () => {
    // Deliberately never resolves -- this is the hang.
    mockGetSession.mockReturnValue(new Promise(() => {}));

    let latest: ReturnType<typeof useAuth> | undefined;
    act(() => {
      create(
        <AuthProvider>
          <Probe onRender={(value) => (latest = value)} />
        </AuthProvider>
      );
    });

    // Before the timeout: still loading, not yet flagged as timed out.
    expect(latest?.loading).toBe(true);
    expect(latest?.loadTimedOut).toBe(false);

    act(() => {
      jest.advanceTimersByTime(10000);
    });

    expect(latest?.loading).toBe(true);
    expect(latest?.loadTimedOut).toBe(true);
  });

  it("never flags loadTimedOut when the session check resolves normally", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    let latest: ReturnType<typeof useAuth> | undefined;
    await act(async () => {
      create(
        <AuthProvider>
          <Probe onRender={(value) => (latest = value)} />
        </AuthProvider>
      );
      // Flush the resolved getSession() promise's microtask queue.
      await Promise.resolve();
    });

    expect(latest?.loading).toBe(false);

    act(() => {
      jest.advanceTimersByTime(10000);
    });

    // The timer fired, but loadTimedOut is gated on still loading --
    // loading already resolved, so a late timer firing is a harmless no-op.
    expect(latest?.loadTimedOut).toBe(false);
  });

  it("retryProfile gives the next attempt a fresh timeout window", () => {
    mockGetSession.mockReturnValue(new Promise(() => {}));

    let latest: ReturnType<typeof useAuth> | undefined;
    act(() => {
      create(
        <AuthProvider>
          <Probe onRender={(value) => (latest = value)} />
        </AuthProvider>
      );
    });

    act(() => {
      jest.advanceTimersByTime(10000);
    });
    expect(latest?.loadTimedOut).toBe(true);

    act(() => {
      latest?.retryProfile();
    });

    // Immediately after retrying, the timeout clears -- the new attempt
    // gets its own full window rather than being instantly re-flagged.
    expect(latest?.loadTimedOut).toBe(false);
  });
});

describe("AuthProvider: returning to the tab keeps the screen", () => {
  // Bug: the load timeout fired once, ten seconds after start, and stayed set.
  // When the tab became visible again the auth library sent a new session for
  // the same user, the profile was fetched again, `loading` flipped on, and
  // with the stale timeout the root layout swapped the whole app for the
  // timeout screen, losing everything the owner had typed.
  const { supabase } = jest.requireMock("../../src/lib/supabase/client") as {
    supabase: { from: jest.Mock };
  };
  const session = (token: string, user = "owner-1") => ({
    access_token: token,
    user: { id: user },
  });
  let profileFetches = 0;

  beforeEach(() => {
    profileFetches = 0;
    supabase.from.mockImplementation(() => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          single: () => {
            profileFetches += 1;
            return Promise.resolve({
              data: { id, full_name: "Owner", role: "owner" },
              error: null,
            });
          },
        }),
      }),
    }));
  });

  async function signedIn() {
    mockGetSession.mockResolvedValue({ data: { session: session("first") } });
    const renders: ReturnType<typeof useAuth>[] = [];
    await act(async () => {
      create(
        <AuthProvider>
          <Probe onRender={(value) => renders.push(value)} />
        </AuthProvider>
      );
    });
    const emit = mockOnAuthStateChange.mock.calls.at(-1)![0] as (
      event: string,
      next: unknown
    ) => void;
    return { renders, emit };
  }

  it("ignores a token refresh for the same user, long after the app loaded", async () => {
    const { renders, emit } = await signedIn();
    expect(renders.at(-1)).toMatchObject({ loading: false, profile: { role: "owner" } });
    expect(profileFetches).toBe(1);

    // The app has been open for a while: the old one-shot timer would have fired.
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    const before = renders.length;
    await act(async () => {
      emit("SIGNED_IN", session("refreshed"));
    });

    const after = renders.slice(before);
    expect(after.every((value) => !value.loading && !value.loadTimedOut)).toBe(true);
    expect(renders.at(-1)?.profile?.role).toBe("owner");
    expect(profileFetches).toBe(1);
  });

  it("still loads the profile when a different user signs in, without a stale timeout", async () => {
    const { renders, emit } = await signedIn();
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    const before = renders.length;
    await act(async () => {
      emit("SIGNED_IN", session("other", "cashier-2"));
    });
    expect(renders.slice(before).some((value) => value.loadTimedOut)).toBe(false);
    expect(profileFetches).toBe(2);
    expect(renders.at(-1)).toMatchObject({ loading: false, profile: { id: "cashier-2" } });
  });

  it("clears the profile on sign-out", async () => {
    const { renders, emit } = await signedIn();
    await act(async () => {
      emit("SIGNED_OUT", null);
    });
    expect(renders.at(-1)).toMatchObject({ loading: false, profile: null, session: null });
  });
});

describe("AuthProvider: a stored session on start", () => {
  it("never reports a signed-in user as loaded before their profile arrives", async () => {
    const { supabase } = jest.requireMock("../../src/lib/supabase/client") as {
      supabase: { from: jest.Mock };
    };
    let resolveProfile: (value: unknown) => void = () => {};
    supabase.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () =>
            new Promise((resolve) => {
              resolveProfile = resolve;
            }),
        }),
      }),
    });
    // The stored session arrives on its own, after the first (signed-out) pass.
    mockGetSession.mockReturnValue(new Promise(() => {}));

    const renders: ReturnType<typeof useAuth>[] = [];
    await act(async () => {
      create(
        <AuthProvider>
          <Probe onRender={(value) => renders.push(value)} />
        </AuthProvider>
      );
    });
    const emit = mockOnAuthStateChange.mock.calls.at(-1)![0] as (e: string, s: unknown) => void;
    await act(async () => {
      emit("INITIAL_SESSION", { user: { id: "owner-1" } });
    });
    await act(async () => {
      resolveProfile({ data: { id: "owner-1", full_name: "Owner", role: "owner" }, error: null });
    });

    // The bug: one render had loading=false with a session and no profile,
    // which the route guard read as a cashier and sent the owner to Vente.
    const premature = renders.filter((r) => !r.loading && r.session && !r.profile);
    expect(premature).toHaveLength(0);
    expect(renders.at(-1)).toMatchObject({ loading: false, profile: { role: "owner" } });
  });
});
