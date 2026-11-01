import { colors } from "./tokens";

// Semantic tones shared by Badge, StatusPill and banners. Every fg/bg pair
// is checked at 4.5:1 in tests/ui/tones.test.ts.
export type Tone = "brand" | "ok" | "warn" | "bad" | "neutral" | "info";

export const tones: Record<Tone, { bg: string; fg: string }> = {
  brand: { bg: colors.brand700, fg: colors.white },
  ok: { bg: colors.success100, fg: colors.success700 },
  warn: { bg: colors.warning100, fg: colors.warning700 },
  bad: { bg: colors.danger600, fg: colors.white },
  neutral: { bg: colors.sunken, fg: colors.ink700 },
  info: { bg: colors.brand100, fg: colors.brand700 },
};

// Soft variant for status pills: tinted background, dark text.
export const softTones: Record<Tone, { bg: string; fg: string }> = {
  brand: { bg: colors.brand100, fg: colors.brand700 },
  ok: tones.ok,
  warn: tones.warn,
  bad: { bg: colors.danger100, fg: colors.danger700 },
  neutral: tones.neutral,
  info: tones.info,
};
