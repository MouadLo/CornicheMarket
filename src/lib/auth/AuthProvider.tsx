import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState } from "react";

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
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

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
      setProfileLoaded(true);
      return;
    }

    let mounted = true;
    setProfileLoaded(false);

    supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        if (mounted) {
          setProfile(data as Profile | null);
          setProfileLoaded(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, [session]);

  const loading = !sessionLoaded || !profileLoaded;

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
