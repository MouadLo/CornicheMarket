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
