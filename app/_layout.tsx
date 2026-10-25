import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/useColorScheme';
import { AuthProvider, useAuth } from '@/src/lib/auth/AuthProvider';
import i18n, { changeLanguage, loadSavedLanguage } from '@/src/i18n';

SplashScreen.preventAutoHideAsync();

function NavigationGuard({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const onSignIn = segments[0] === 'sign-in';
    const onAcceptInvite = segments[0] === 'accept-invite';

    if (!session && !onSignIn && !onAcceptInvite) {
      router.replace('/sign-in');
    } else if (session && onSignIn) {
      router.replace('/(app)/sell');
    }
  }, [session, loading, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    loadSavedLanguage()
      .then((saved) => { if (saved) return changeLanguage(saved); })
      .finally(() => setI18nReady(true));
  }, []);

  useEffect(() => {
    if (loaded && i18nReady) SplashScreen.hideAsync();
  }, [loaded, i18nReady]);

  if (!loaded || !i18nReady) return null;

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AuthProvider>
          <NavigationGuard>
            <Stack>
              <Stack.Screen name="(app)" options={{ headerShown: false }} />
              <Stack.Screen name="sign-in" options={{ headerShown: false }} />
              <Stack.Screen name="accept-invite" options={{ title: 'Set your password' }} />
              <Stack.Screen name="+not-found" />
            </Stack>
          </NavigationGuard>
        </AuthProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
