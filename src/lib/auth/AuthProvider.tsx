import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { supabase } from "@/src/lib/supabase/client";

export type Role = "owner" | "cashier";

export type Profile = {
  id: string;
  full_name: string;
  role: Role;
};

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileError: string | null;
  loadTimedOut: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  retryProfile: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// If getSession()/the profile fetch hasn't resolved by the time this fires,
// something is hung -- a misconfigured Supabase URL (e.g. a raw Postgres
// connection string instead of the API gateway URL), the local stack not
// running, or a dead network -- and "loading" would otherwise spin on
// app/index.tsx's bare ActivityIndicator forever with no way out. The
// loading state must always resolve to something the user can act on.
const LOAD_TIMEOUT_MS = 10000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileRetry, setProfileRetry] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  // Re-runs on profileRetry too: the hang that needs retrying might be
  // getSession() itself (e.g. a Supabase URL that can't be reached at
  // all), not just the profile fetch below, so Retry has to be able to
  // restart this step as well, not only the one after it.
  useEffect(() => {
    let mounted = true;
    setSessionLoaded(false);

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setSessionLoaded(true);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) {
        setSession(nextSession);
        setSessionLoaded(true);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [profileRetry]);

  // The profile depends on who is signed in, not on the session object: the
  // auth library hands out a new session for the same user whenever it
  // refreshes the token (on a timer, and each time a browser tab becomes
  // visible again). Re-fetching then would flip `loading` on and off for
  // nothing; see the timeout below for why that used to wipe the screen.
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setProfileError(null);
      setProfileLoaded(true);
      return;
    }

    let mounted = true;
    setProfileLoaded(false);
    setProfileError(null);

    supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("id", userId)
      .single()
      .then(({ data, error }) => {
        if (mounted) {
          if (error || !data) {
            setProfileError(error?.message ?? "Profile not found");
            setProfile(null);
          } else {
            setProfile(data as Profile);
          }
          setProfileLoaded(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, [userId, profileRetry]);

  const loading = !sessionLoaded || !profileLoaded;

  // Counts only while loading. It used to start once at mount and stay "timed
  // out" for good after ten seconds, so any later moment of loading (such as
  // returning to the tab) replaced the whole app with the timeout screen,
  // throwing away whatever the owner had typed. Re-runs on profileRetry too,
  // so Retry gives the next attempt its own fresh window.
  useEffect(() => {
    setTimedOut(false);
    if (!loading) return;
    const timer = setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loading, profileRetry]);
  const loadTimedOut = loading && timedOut;

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const retryProfile = useCallback(() => setProfileRetry((n) => n + 1), []);

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        profileError,
        loadTimedOut,
        signIn,
        signOut,
        retryProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
