import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager, Platform } from 'react-native';

import ar from './ar';
import en from './en';
import fr from './fr';

export type SupportedLang = 'fr' | 'en' | 'ar';
const STORAGE_KEY = '@corniche/language';

export async function loadSavedLanguage(): Promise<SupportedLang | null> {
  try {
    return (await AsyncStorage.getItem(STORAGE_KEY)) as SupportedLang | null;
  } catch {
    return null;
  }
}

// Returns true when a native restart is needed to flip RTL.
export async function changeLanguage(lang: SupportedLang): Promise<boolean> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, lang);
  } catch {}

  await i18n.changeLanguage(lang);

  const needsRTL = lang === 'ar';

  if (Platform.OS === 'web') {
    document.documentElement.setAttribute('dir', needsRTL ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', lang);
    return false;
  }

  const rtlChanged = needsRTL !== I18nManager.isRTL;
  if (rtlChanged) {
    I18nManager.allowRTL(needsRTL);
    I18nManager.forceRTL(needsRTL);
  }
  return rtlChanged;
}

function detectDeviceLanguage(): SupportedLang {
  const code = getLocales()[0]?.languageCode ?? 'fr';
  if (code === 'ar') return 'ar';
  if (code === 'en') return 'en';
  return 'fr';
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: detectDeviceLanguage(),
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
});

export default i18n;
