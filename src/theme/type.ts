// Type scale for reading at arm's length on a counter (docs/THEME-STRUCTURE.md 2.3).
// IBM Plex Sans for fr/en, IBM Plex Sans Arabic for ar (it carries Latin too, so
// product names typed in French inside an Arabic screen keep the same family).
// Arabic running text is one step larger with more line height; numbers are
// always Western digits with tabular figures.

export type Lang = "fr" | "en" | "ar";
export type TypeToken = "meta" | "caption" | "body" | "subtitle" | "title" | "kpi" | "total";
export type FontWeight = "regular" | "semibold" | "bold";

export const typeScale: Record<TypeToken, { latin: number; arabic: number; weight: FontWeight }> = {
  meta: { latin: 13, arabic: 14, weight: "semibold" },
  caption: { latin: 15, arabic: 16, weight: "regular" },
  body: { latin: 17, arabic: 18, weight: "regular" },
  subtitle: { latin: 20, arabic: 21, weight: "semibold" },
  title: { latin: 24, arabic: 25, weight: "bold" },
  kpi: { latin: 32, arabic: 32, weight: "bold" },
  total: { latin: 44, arabic: 44, weight: "bold" },
};

export const fontFamilies = {
  latin: {
    regular: "IBMPlexSans_400Regular",
    semibold: "IBMPlexSans_600SemiBold",
    bold: "IBMPlexSans_700Bold",
  },
  arabic: {
    regular: "IBMPlexSansArabic_400Regular",
    semibold: "IBMPlexSansArabic_600SemiBold",
    bold: "IBMPlexSansArabic_700Bold",
  },
} as const;

// RN custom fonts have no weight axis: each weight is its own family name.
export function weightFromStyle(fontWeight: unknown): FontWeight {
  if (
    fontWeight === "bold" ||
    fontWeight === "700" ||
    fontWeight === "800" ||
    fontWeight === "900" ||
    fontWeight === 700 ||
    fontWeight === 800 ||
    fontWeight === 900
  )
    return "bold";
  if (fontWeight === "600" || fontWeight === 600 || fontWeight === "500" || fontWeight === 500)
    return "semibold";
  return "regular";
}

export function fontFamilyFor(lang: Lang, weight: FontWeight): string {
  return fontFamilies[lang === "ar" ? "arabic" : "latin"][weight];
}

export function textStyle(token: TypeToken, lang: Lang) {
  const t = typeScale[token];
  const size = lang === "ar" ? t.arabic : t.latin;
  return {
    fontFamily: fontFamilyFor(lang, t.weight),
    fontSize: size,
    lineHeight: Math.round(size * (lang === "ar" ? 1.55 : 1.35)),
  };
}

export const tabularNumbers = { fontVariant: ["tabular-nums" as const] };
