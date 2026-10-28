// Date.prototype.toLocaleDateString() with no locale argument reads the
// BROWSER/OS locale, not the app's selected language -- the same class of
// "whoever is looking at the screen, not the shop" bug as the time zone
// one. A French-interface user on an English-configured device would see
// MM/DD/YYYY dates. These map the app's i18n language to an explicit
// locale instead.
//
// numberingSystem is forced to "latn" (Western 0-9 digits) for Arabic:
// Moroccan businesses conventionally use Western digits even in Arabic
// text, including for dates -- Eastern Arabic-Indic digits (١٢٣) would
// look inconsistent next to the rest of the app's Western-numeral money
// figures.
const LOCALE_BY_LANGUAGE: Record<string, string> = {
  fr: "fr-FR",
  en: "en-GB",
  ar: "ar-MA-u-nu-latn",
};

function resolveLocale(language: string): string {
  return LOCALE_BY_LANGUAGE[language] ?? "fr-FR";
}

export function formatLocaleDate(date: Date, language: string): string {
  return date.toLocaleDateString(resolveLocale(language), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatLocaleDateTime(date: Date, language: string): string {
  return date.toLocaleString(resolveLocale(language), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
