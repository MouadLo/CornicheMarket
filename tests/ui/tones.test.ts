import { contrastRatio } from "../../src/theme/contrast";
import { softTones, tones } from "../../src/theme/tones";

describe("tones", () => {
  it.each([
    ...Object.entries(tones),
    ...Object.entries(softTones).map(([k, v]) => [`soft ${k}`, v] as const),
  ])("%s text is at least 4.5:1 on its background", (_name, { bg, fg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
