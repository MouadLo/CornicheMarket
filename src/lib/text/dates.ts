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

export function resolveLocale(language: string): string {
  return LOCALE_BY_LANGUAGE[language] ?? "fr-FR";
}

export function formatLocaleDate(date: Date, language: string, timeZone?: string): string {
  return date.toLocaleDateString(resolveLocale(language), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  });
}

// Date and time, no seconds. Pass the store's time zone where the screen has one.
export function formatLocaleDateTime(date: Date, language: string, timeZone?: string): string {
  return date.toLocaleString(resolveLocale(language), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });
}

// Day and month only ("05/01"), for tight chart labels.
export function formatLocaleDayMonth(date: Date, language: string, timeZone?: string): string {
  return date.toLocaleDateString(resolveLocale(language), {
    day: "2-digit",
    month: "2-digit",
    timeZone,
  });
}

// "janvier 2026". A month bucket comes from the database already cut at the
// start of the month, so it is read in UTC unless a zone is given.
export function formatLocaleMonthYear(
  date: Date,
  language: string,
  timeZone: string = "UTC"
): string {
  return date.toLocaleDateString(resolveLocale(language), {
    month: "long",
    year: "numeric",
    timeZone,
  });
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// A value from the API that is either a plain calendar date ("2026-01-05", no
// time) or a full timestamp. A plain date names a day, not an instant, so it is
// read in UTC and never moves to the neighbouring day whatever the device zone.
export function formatIsoDate(value: string, language: string, timeZone?: string): string {
  if (DATE_ONLY.test(value))
    return formatLocaleDate(new Date(`${value}T00:00:00Z`), language, "UTC");
  return formatLocaleDate(new Date(value), language, timeZone);
}

// Sales history: times and day headings are read in the STORE's time zone
// (not the device's) and in the app language, without seconds.
export function formatLocaleTime(date: Date, language: string, timeZone?: string): string {
  return date.toLocaleTimeString(resolveLocale(language), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });
}

export function formatLocaleDayHeading(date: Date, language: string, timeZone?: string): string {
  return date.toLocaleDateString(resolveLocale(language), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  });
}
