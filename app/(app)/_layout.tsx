import { Redirect, Slot, usePathname } from "expo-router";

import { AppShell } from "@/src/components/shell/AppShell";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { guardRedirect } from "@/src/lib/nav/sections";

// Everything signed-in lives inside the POS shell (top bar, navigation,
// alerts). The role check here is the real gate: a cashier who opens an
// owner-only URL is sent back to Vente, whatever the navigation shows.
export default function AppLayout() {
  const { profile } = useAuth();
  const pathname = usePathname();
  const redirect = guardRedirect(profile?.role ?? null, pathname);
  if (redirect) return <Redirect href={redirect as never} />;
  return (
    <AppShell>
      <Slot />
    </AppShell>
  );
}
