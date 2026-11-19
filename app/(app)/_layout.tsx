import { Redirect, Slot, usePathname } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { AppShell } from "@/src/components/shell/AppShell";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { guardRedirect } from "@/src/lib/nav/sections";
import { colors } from "@/src/theme/tokens";

// Everything signed-in lives inside the POS shell (top bar, navigation,
// alerts). The role check here is the real gate: a cashier who opens an
// owner-only URL is sent back to Vente, whatever the navigation shows.
export default function AppLayout() {
  const { profile, loading } = useAuth();
  const pathname = usePathname();

  // The role is unknown until the profile arrives (e.g. right after a browser
  // reload): deciding then would treat the owner as a cashier and bounce them
  // to Vente. The page stays mounted but hidden under a spinner meanwhile:
  // on web, a layout that renders no <Slot /> makes the router drop the URL it
  // was opened on and fall back to the home route, so a plain spinner here
  // loses the page too. Nothing of the page is visible or tappable until the
  // role is known, and the database refuses cost data to a cashier either way.
  // The root NavigationGuard replaces all of this with the timeout / error /
  // deactivated screens if loading never resolves.
  if (!loading) {
    const redirect = guardRedirect(profile?.role ?? null, pathname);
    if (redirect) return <Redirect href={redirect as never} />;
  }
  return (
    <View style={styles.fill}>
      <View
        style={[styles.fill, loading && styles.hidden]}
        aria-hidden={loading}
        pointerEvents={loading ? "none" : "auto"}
      >
        <AppShell>
          <Slot />
        </AppShell>
      </View>
      {loading && (
        <View style={styles.cover} testID="app-auth-loading">
          <ActivityIndicator />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { opacity: 0 },
  cover: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
});
