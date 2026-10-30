import ar from "../../src/i18n/ar";
import en from "../../src/i18n/en";
import fr from "../../src/i18n/fr";

// Arabic has six CLDR plural categories (zero/one/two/few/many/other), not
// just one/other. i18next picks the category by the actual count (9 is
// "few", 15 is "many"), and when the CURRENT language is missing that
// category, it silently falls through to fallbackLng ('fr') instead of
// showing a blank or an error -- so a half-finished Arabic plural set shows
// French text to an Arabic-reading user with no visible sign anything is
// wrong. This caught exactly that: units.piece_few was missing from ar.ts,
// so any Arabic UI showing 3-10 of something (a very common quantity on a
// receipt) silently rendered in French.
const PLURAL_CATEGORIES = ["zero", "one", "two", "few", "many", "other"] as const;

describe("Arabic plural coverage", () => {
  it("every pluralized units key has all six CLDR categories in ar.ts", () => {
    const bases = ["piece", "pack", "kg"];
    for (const base of bases) {
      for (const category of PLURAL_CATEGORIES) {
        const key = `${base}_${category}` as keyof typeof ar.units;
        expect(ar.units[key]).toBeDefined();
        expect(typeof ar.units[key]).toBe("string");
        expect((ar.units[key] as string).length).toBeGreaterThan(0);
      }
    }
  });

  it("fr.ts and en.ts carry the same plural category keys ar.ts needs, so Translations accepts ar.ts's full set", () => {
    const bases = ["piece", "pack", "kg"];
    for (const base of bases) {
      for (const category of PLURAL_CATEGORIES) {
        const key = `${base}_${category}`;
        expect(Object.keys(fr.units)).toContain(key);
        expect(Object.keys(en.units)).toContain(key);
      }
    }
  });
});
