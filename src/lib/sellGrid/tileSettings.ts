// What the owner sets for one product on its Sell tile (O7), as pure helpers.
// The settings live in sell_grid_tiles (migration 029): "Favorites" is a tile
// on the favorites tab; the colour is written on the product's tile in every tab
// that shows it (its Favorites tile, and an override row on its category tab).
import type { TileColor } from "@/src/lib/sellGrid/layout";

export const TILE_COLORS: TileColor[] = [
  "green",
  "teal",
  "blue",
  "indigo",
  "purple",
  "red",
  "amber",
  "grey",
];

export type TileSettings = { favorite: boolean; color: TileColor | null };

export const DEFAULT_TILE_SETTINGS: TileSettings = { favorite: false, color: null };

// A category-tab row that only carries a colour has no place of its own: Sell
// keeps such a product where the automatic (alphabetical) order puts it.
export const UNORDERED_POSITION = -1;

// The save failed after the product itself was saved. The form shows its own
// message and stays usable; saving again repeats the (idempotent) grid write.
export class TileSettingsError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super("tile settings were not saved");
    this.name = "TileSettingsError";
    this.cause = cause;
  }
}

export function tileSettingsEqual(a: TileSettings, b: TileSettings): boolean {
  return a.favorite === b.favorite && a.color === b.color;
}

// The grid is only written when something about it changed. A colour must also
// follow the product to a new category tab, so a category change counts too.
export function needsGridWrite(
  initial: TileSettings,
  next: TileSettings,
  initialTabCategoryId: string | null,
  nextTabCategoryId: string | null
): boolean {
  if (!tileSettingsEqual(initial, next)) return true;
  return next.color !== null && initialTabCategoryId !== nextTabCategoryId;
}

// What the form hands the screen to write: the settings and the tab that holds
// the product's category (a sub-category's products show in its parent's tab).
export type TileChange = { settings: TileSettings; tabCategoryId: string | null };
