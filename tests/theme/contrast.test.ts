import { contrastRatio } from "@/src/theme/contrast";
import { colors } from "@/src/theme/tokens";

const c = colors;

// Every text/background pair the shared components and prototype use.
// WCAG 2.1 AA: 4.5:1 for text.
const TEXT_PAIRS: [string, string, string][] = [
  ["ink900", c.ink900, c.surface],
  ["ink900", c.ink900, c.bg],
  ["ink700", c.ink700, c.surface],
  ["ink600", c.ink600, c.surface],
  ["ink600", c.ink600, c.bg],
  ["ink600", c.ink600, c.sunken],
  ["ink600", c.ink600, c.brand100],
  ["white", c.white, c.brand700],
  ["white", c.white, c.brand800],
  ["white", c.white, c.success600],
  ["white", c.white, c.danger600],
  ["brand700", c.brand700, c.surface],
  ["brand700", c.brand700, c.bg],
  ["brand700", c.brand700, c.brand100],
  ["success700", c.success700, c.surface],
  ["success700", c.success700, c.success100],
  ["danger600", c.danger600, c.surface],
  ["danger700", c.danger700, c.danger100],
  ["warning700", c.warning700, c.warning100],
  ["warning700", c.warning700, c.surface],
  ["disabledFg", c.disabledFg, c.disabledBg],
];

describe("design tokens: contrast", () => {
  it.each(TEXT_PAIRS)("%s text is at least 4.5:1 (%s on %s)", (_n, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("input outlines reach 3:1 against the surface (WCAG 1.4.11)", () => {
    expect(contrastRatio(c.ink400, c.surface)).toBeGreaterThanOrEqual(3);
  });

  it("matches known reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio(c.white, c.brand700)).toBeCloseTo(8.7, 1);
  });
});
