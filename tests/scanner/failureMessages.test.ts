import ar from "../../src/i18n/ar";
import en from "../../src/i18n/en";
import fr from "../../src/i18n/fr";

const KEYS = [
  "webDenied",
  "webNotFound",
  "webInUse",
  "webInsecure",
  "webGeneric",
  "tryAgain",
  "close",
] as const;

describe("camera failure messages", () => {
  it.each([
    ["fr", fr],
    ["en", en],
    ["ar", ar],
  ])("%s has a translated message for every failure state", (_name, tr) => {
    for (const key of KEYS) {
      const text = tr.barcodeScanner[key];
      expect(text.length).toBeGreaterThan(key === "close" || key === "tryAgain" ? 2 : 15);
      // never raw browser error text
      expect(text).not.toMatch(/NotAllowedError|NotFoundError|NotReadableError|Permission denied/i);
    }
  });

  it("the denied message explains the browser settings in each language", () => {
    expect(en.barcodeScanner.webDenied).toMatch(/settings/i);
    expect(fr.barcodeScanner.webDenied).toMatch(/réglages/i);
    expect(ar.barcodeScanner.webDenied).toMatch(/إعدادات/);
  });
});
