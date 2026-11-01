// Corniche Market design tokens. Source: docs/THEME-STRUCTURE.md, Part 2
// (names match docs/prototype/assets/tokens.css). Money is always integer
// centimes elsewhere; this file is colours, space, shape and touch sizes only.

export const colors = {
  // Brand: "Atlantique" (the sea off the Corniche).
  brand800: "#093f50",
  brand700: "#0b5266", // primary buttons, active nav, links
  brand600: "#0e6680", // focus ring, chart bars
  brand300: "#8fb8c4", // secondary chart bars
  brand100: "#e3f0f3", // selected chip, info background
  brand50: "#f0f7f9",
  sand500: "#e9a93a", // identity only (logo sun, star). Never white text, never a state.

  // Ink and surfaces.
  ink900: "#15212b",
  ink700: "#35434f",
  ink600: "#52606c",
  ink400: "#8592a0", // outlines and placeholder icons only (3.2:1), never text
  border: "#c9d1d8",
  divider: "#e7ebee",
  bg: "#f6f4ef",
  surface: "#ffffff",
  sunken: "#eef1f3",
  white: "#ffffff",
  black: "#000000",

  // Semantic. Money in = success, money out / loss / destructive = danger.
  success700: "#16653a",
  success600: "#1d7a46", // the "money in" button
  success100: "#e2f2e8",
  danger700: "#9a1f18",
  danger600: "#b3261e",
  danger100: "#fbe6e4",
  warning700: "#7a4f00",
  warning500: "#d99a1e", // icon / border only
  warning100: "#fff2d3",
  disabledBg: "#e1e5e8",
  disabledFg: "#4f5b66",
} as const;

export const spacing = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 24, s6: 32, s7: 48 } as const;

// Two radii. Pills (chips, badges) use `pill`: a shape, not a third radius.
export const radius = { control: 10, panel: 16, pill: 999 } as const;

export const touch = { min: 48, lg: 56, key: 64, pay: 72 } as const;

export type ColorToken = keyof typeof colors;
