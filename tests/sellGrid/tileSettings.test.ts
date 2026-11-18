import {
  DEFAULT_TILE_SETTINGS,
  needsGridWrite,
  TILE_COLORS,
  tileSettingsEqual,
} from "../../src/lib/sellGrid/tileSettings";
import { tilePalette } from "../../src/theme/tokens";

describe("tile settings", () => {
  it("offers exactly the palette colours", () => {
    expect([...TILE_COLORS].sort()).toEqual(Object.keys(tilePalette).sort());
  });

  it("compares settings", () => {
    expect(tileSettingsEqual(DEFAULT_TILE_SETTINGS, { favorite: false, color: null })).toBe(true);
    expect(tileSettingsEqual(DEFAULT_TILE_SETTINGS, { favorite: true, color: null })).toBe(false);
  });

  it("writes the grid only when something changed", () => {
    const same = { favorite: true, color: "red" as const };
    expect(needsGridWrite(same, same, "c1", "c1")).toBe(false);
    expect(needsGridWrite(same, { ...same, color: "blue" }, "c1", "c1")).toBe(true);
    expect(needsGridWrite(same, { ...same, favorite: false }, "c1", "c1")).toBe(true);
  });

  it("a colour follows the product to a new category tab; the default has nothing to move", () => {
    expect(
      needsGridWrite(
        { favorite: false, color: "red" },
        { favorite: false, color: "red" },
        "c1",
        "c2"
      )
    ).toBe(true);
    expect(needsGridWrite(DEFAULT_TILE_SETTINGS, DEFAULT_TILE_SETTINGS, "c1", "c2")).toBe(false);
  });
});
