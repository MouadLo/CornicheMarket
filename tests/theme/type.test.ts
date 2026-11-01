import { fontFamilyFor, textStyle, typeScale, weightFromStyle } from "@/src/theme/type";

describe("type scale", () => {
  it("is readable at arm's length: body 17, total 44", () => {
    expect(typeScale.body.latin).toBe(17);
    expect(typeScale.total.latin).toBe(44);
  });

  it("Arabic running text is one step larger with more line height; numbers do not grow", () => {
    expect(textStyle("body", "ar").fontSize).toBe(18);
    expect(textStyle("body", "ar").lineHeight).toBeGreaterThan(textStyle("body", "fr").lineHeight);
    expect(textStyle("total", "ar").fontSize).toBe(textStyle("total", "fr").fontSize);
  });

  it("uses the Arabic family only for ar", () => {
    expect(fontFamilyFor("ar", "bold")).toBe("IBMPlexSansArabic_700Bold");
    expect(fontFamilyFor("fr", "bold")).toBe("IBMPlexSans_700Bold");
    expect(fontFamilyFor("en", "regular")).toBe("IBMPlexSans_400Regular");
  });

  it("maps CSS-style weights to the three bundled weights", () => {
    expect(weightFromStyle(undefined)).toBe("regular");
    expect(weightFromStyle("400")).toBe("regular");
    expect(weightFromStyle("600")).toBe("semibold");
    expect(weightFromStyle("700")).toBe("bold");
    expect(weightFromStyle("800")).toBe("bold");
    expect(weightFromStyle("bold")).toBe("bold");
  });
});
