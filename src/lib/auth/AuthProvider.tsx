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
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  retryProfile: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileRetry, setProfileRetry] = useState(0);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setSessionLoaded(true);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSessionLoaded(true);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
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
      .eq("id", session.user.id)
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
  }, [session, profileRetry]);

  const loading = !sessionLoaded || !profileLoaded;

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
      value={{ session, profile, loading, profileError, signIn, signOut, retryProfile }}
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
