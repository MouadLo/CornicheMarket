import { Redirect, Slot, usePathname } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { AppShell } from "@/src/components/shell/AppShell";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { guardRedirect } from "@/src/lib/nav/sections";

// Everything signed-in lives inside the POS shell (top bar, navigation,
// alerts). The role check here is the real gate: a cashier who opens an
// owner-only URL is sent back to Vente, whatever the navigation shows.
export default function AppLayout() {
  const { profile, loading } = useAuth();
  const pathname = usePathname();
  // The role is unknown until the profile arrives (e.g. right after a browser
  // reload): deciding now would treat the owner as a cashier and bounce them to
  // Vente. The root NavigationGuard replaces this with the timeout / error /
  // deactivated screens if loading never resolves, so this cannot spin forever.
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  const redirect = guardRedirect(profile?.role ?? null, pathname);
  if (redirect) return <Redirect href={redirect as never} />;
  return (
    <AppShell>
      <Slot />
    </AppShell>
  );
}
