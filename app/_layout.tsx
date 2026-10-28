import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { I18nextProvider } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import "react-native-reanimated";

import { useColorScheme } from "@/hooks/useColorScheme";
import { AuthProvider, useAuth } from "@/src/lib/auth/AuthProvider";
import i18n, { changeLanguage, loadSavedLanguage } from "@/src/i18n";

SplashScreen.preventAutoHideAsync();

function NavigationGuard({ children }: { children: React.ReactNode }) {
  const { session, loading, profileError, loadTimedOut, retryProfile, signOut } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const onSignIn = segments[0] === "sign-in";
    const onAcceptInvite = segments[0] === "accept-invite";
    const inApp = segments[0] === "(app)";

    if (!session && !onSignIn && !onAcceptInvite) {
      router.replace("/sign-in");
    } else if (session && !inApp && !onAcceptInvite) {
      // Covers both arriving at /sign-in while already signed in AND
      // landing on the bare index route (segments is empty there) with a
      // persisted session -- e.g. a web user reloading or bookmarking "/".
      // Without the second case, app/index.tsx's spinner never resolves:
      // nothing was ever redirecting a logged-in user away from "/" itself.
      router.replace("/(app)/sell");
    }
  }, [session, loading, segments, router]);

  // Still loading after LOAD_TIMEOUT_MS: something is hung (wrong Supabase
  // URL, local stack not running, dead network) rather than slow. Without
  // this, the user is stuck on app/index.tsx's bare spinner forever with
  // no way out. No "Sign out" here -- signOut() is itself a network call
  // that would hang the same way, and we may not even know yet whether
  // there is a session to sign out of.
  if (loading && loadTimedOut) {
    return (
      <View style={guardStyles.container}>
        <Text style={guardStyles.title}>Le chargement prend trop de temps</Text>
        <Text style={guardStyles.message}>
          Impossible de contacter Supabase. Si vous utilisez Supabase local, vérifiez que `npx
          supabase start` est lancé et que EXPO_PUBLIC_SUPABASE_URL (dans .env ou .env.local) est
          bien l&apos;URL affichée par `npx supabase status` — pas la chaîne de connexion
          postgresql://. Sinon, vérifiez votre connexion internet.
        </Text>
        <Pressable style={guardStyles.retryButton} onPress={retryProfile}>
          <Text style={guardStyles.retryText}>Réessayer</Text>
        </Pressable>
      </View>
    );
  }

  if (!loading && profileError) {
    return (
      <View style={guardStyles.container}>
        <Text style={guardStyles.title}>Impossible de charger le profil</Text>
        <Text style={guardStyles.message}>{profileError}</Text>
        <Pressable style={guardStyles.retryButton} onPress={retryProfile}>
          <Text style={guardStyles.retryText}>Réessayer</Text>
        </Pressable>
        <Pressable onPress={signOut}>
          <Text style={guardStyles.signOutText}>Se déconnecter</Text>
        </Pressable>
      </View>
    );
  }

  return <>{children}</>;
}

const guardStyles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 16 },
  title: { fontSize: 20, fontWeight: "700", textAlign: "center" },
  message: { fontSize: 15, color: "#555", textAlign: "center" },
  retryButton: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    backgroundColor: "#1d7a46",
    borderRadius: 10,
  },
  retryText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  signOutText: { color: "#b3261e", fontSize: 15 },
});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    loadSavedLanguage()
      .then((saved) => {
        if (saved) return changeLanguage(saved);
      })
      .finally(() => setI18nReady(true));
  }, []);

  useEffect(() => {
    if (loaded && i18nReady) SplashScreen.hideAsync();
  }, [loaded, i18nReady]);

  if (!loaded || !i18nReady) return null;

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <AuthProvider>
          <NavigationGuard>
            <Stack>
              <Stack.Screen name="(app)" options={{ headerShown: false }} />
              <Stack.Screen name="sign-in" options={{ headerShown: false }} />
              <Stack.Screen name="accept-invite" options={{ title: "Set your password" }} />
              <Stack.Screen name="+not-found" />
            </Stack>
          </NavigationGuard>
        </AuthProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
