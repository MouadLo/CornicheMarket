import {
  entryToQuantity,
  isScannerBurst,
  keyFromKeyboardEvent,
  pressKey,
  type WeightKey,
} from "../../src/lib/sales/weightEntry";

function type(keys: WeightKey[], start = ""): string {
  return keys.reduce((entry, key) => pressKey(entry, key), start);
}

describe("pressKey: the weight keypad's text entry", () => {
  it("builds 0.5 from 0 . 5", () => {
    expect(type(["0", ".", "5"])).toBe("0.5");
  });

  it("a leading '.' becomes '0.'", () => {
    expect(type([".", "2", "5"])).toBe("0.25");
  });

  it("ignores a second decimal point", () => {
    expect(type(["1", ".", "5", "."])).toBe("1.5");
  });

  it("replaces a lone leading zero instead of stacking zeros", () => {
    expect(type(["0", "0", "7"])).toBe("7");
  });

  it("allows at most 3 decimals (grams)", () => {
    expect(type(["0", ".", "1", "2", "5", "9"])).toBe("0.125");
  });

  it("allows at most 2 integer digits (99.999 kg cap)", () => {
    expect(type(["1", "2", "3"])).toBe("12");
    expect(type(["9", "9", ".", "9", "9", "9"])).toBe("99.999");
  });

  it("backspace removes the last character, and is a no-op when empty", () => {
    expect(type(["1", ".", "5", "back"])).toBe("1.");
    expect(type(["back"])).toBe("");
  });
});

describe("entryToQuantity", () => {
  it("parses to exact grams", () => {
    expect(entryToQuantity("0.125")).toBe(0.125);
    expect(entryToQuantity("0.5")).toBe(0.5);
    expect(entryToQuantity("2.")).toBe(2);
  });

  it("is null for empty, zero, or an unfinished decimal that is still zero", () => {
    expect(entryToQuantity("")).toBeNull();
    expect(entryToQuantity("0")).toBeNull();
    expect(entryToQuantity("0.")).toBeNull();
    expect(entryToQuantity("0.000")).toBeNull();
  });
});

describe("keyFromKeyboardEvent: physical keyboard on web", () => {
  it("maps digits, both decimal separators, Backspace, Enter and Escape", () => {
    expect(keyFromKeyboardEvent("7")).toBe("7");
    expect(keyFromKeyboardEvent(".")).toBe(".");
    expect(keyFromKeyboardEvent(",")).toBe(".");
    expect(keyFromKeyboardEvent("Backspace")).toBe("back");
    expect(keyFromKeyboardEvent("Enter")).toBe("enter");
    expect(keyFromKeyboardEvent("Escape")).toBe("escape");
  });

  it("ignores everything else", () => {
    for (const key of ["a", "-", " ", "Tab", "ArrowLeft", "Shift", "10"]) {
      expect(keyFromKeyboardEvent(key)).toBeNull();
    }
  });
});

describe("isScannerBurst: a scanner types far faster than a person", () => {
  it("is false for the first key and for human typing speed", () => {
    expect(isScannerBurst(null, 1000)).toBe(false);
    expect(isScannerBurst(1000, 1090)).toBe(false);
  });

  it("is true for keys arriving a few milliseconds apart", () => {
    expect(isScannerBurst(1000, 1005)).toBe(true);
    expect(isScannerBurst(1000, 1034)).toBe(true);
    expect(isScannerBurst(1000, 1035)).toBe(false);
  });
});
