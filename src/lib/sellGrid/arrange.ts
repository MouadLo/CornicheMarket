// Arranging the Sell grid (UX_REVIEW O7), as pure functions: the working copy
// the owner edits, its moves, where a dragged tile lands, and the one payload
// that saves everything (save_sell_grid_arrangement, migration 044).
import {
  resolveGrid,
  type GridCategory,
  type GridProduct,
  type GridTab,
  type GridTile,
  type ResolvedTile,
  type TileColor,
} from "@/src/lib/sellGrid/layout";

export type ArrangeTile = {
  key: string; // the product id
  product: GridProduct;
  label: string;
  color: TileColor | null;
  hidden: boolean;
};

export type ArrangeTab = {
  id: string;
  kind: GridTab["kind"];
  label: string;
  visible: boolean;
  tiles: ArrangeTile[];
};

// What Sell shows plus what it hides: every tab that has tiles (hidden tabs
// included, with their flag) and, in each, the shown tiles in Sell's order
// followed by the hidden ones. Tabs with no tile at all stay out: there is
// nothing to arrange on them.
export function resolveArrangeTabs(input: {
  tabs: GridTab[];
  tiles: GridTile[];
  products: GridProduct[];
  categories: GridCategory[];
  favoritesLabel: string;
}): ArrangeTab[] {
  const allTabs = input.tabs.map((tab) => ({ ...tab, visible: true }));
  const shown = resolveGrid({ ...input, tabs: allTabs });
  const everything = resolveGrid({
    ...input,
    tabs: allTabs,
    tiles: input.tiles.map((row) => ({ ...row, hidden: false })),
  });
  const visibleById = new Map(input.tabs.map((tab) => [tab.id, tab.visible]));
  const shownById = new Map(shown.map((tab) => [tab.id, tab.tiles]));

  return everything.map((tab) => {
    const shownTiles = shownById.get(tab.id) ?? [];
    const shownKeys = new Set(shownTiles.map((tile) => tile.key));
    const asArrange = (tile: ResolvedTile, hidden: boolean): ArrangeTile => ({
      key: tile.key,
      product: tile.product,
      label: tile.label,
      color: tile.color,
      hidden,
    });
    return {
      id: tab.id,
      kind: tab.kind,
      label: tab.label,
      visible: visibleById.get(tab.id) ?? true,
      tiles: [
        ...shownTiles.map((tile) => asArrange(tile, false)),
        ...tab.tiles
          .filter((tile) => !shownKeys.has(tile.key))
          .map((tile) => asArrange(tile, true)),
      ],
    };
  });
}

// ---- Moves ----

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const target = Math.max(0, Math.min(list.length - 1, to));
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

// Shown tiles first, hidden ones last, each group in its own order.
function hiddenLast(tiles: ArrangeTile[]): ArrangeTile[] {
  return [...tiles.filter((t) => !t.hidden), ...tiles.filter((t) => t.hidden)];
}

function withTab(
  tabs: ArrangeTab[],
  tabId: string,
  change: (tab: ArrangeTab) => ArrangeTab
): ArrangeTab[] {
  return tabs.map((tab) => (tab.id === tabId ? change(tab) : tab));
}

export function moveTile(tabs: ArrangeTab[], tabId: string, from: number, to: number) {
  return withTab(tabs, tabId, (tab) => ({
    ...tab,
    tiles: hiddenLast(moveItem(tab.tiles, from, to)),
  }));
}

// Hiding sends the tile to the end; showing it puts it after the shown ones.
export function toggleTileHidden(tabs: ArrangeTab[], tabId: string, productId: string) {
  return withTab(tabs, tabId, (tab) => {
    const tile = tab.tiles.find((t) => t.key === productId);
    if (!tile) return tab;
    const rest = tab.tiles.filter((t) => t !== tile);
    const flipped = { ...tile, hidden: !tile.hidden };
    if (flipped.hidden) return { ...tab, tiles: [...rest, flipped] };
    const shownCount = rest.filter((t) => !t.hidden).length;
    return { ...tab, tiles: [...rest.slice(0, shownCount), flipped, ...rest.slice(shownCount)] };
  });
}

export function moveTab(tabs: ArrangeTab[], from: number, to: number) {
  return moveItem(tabs, from, to);
}

export function visibleTabCount(tabs: ArrangeTab[]): number {
  return tabs.filter((tab) => tab.visible).length;
}

// At least one tab stays visible: hiding the last one is refused (unchanged).
export function toggleTabVisible(tabs: ArrangeTab[], tabId: string): ArrangeTab[] {
  const tab = tabs.find((x) => x.id === tabId);
  if (!tab) return tabs;
  if (tab.visible && visibleTabCount(tabs) <= 1) return tabs;
  return withTab(tabs, tabId, (x) => ({ ...x, visible: !x.visible }));
}

// ---- Dropping a dragged tile ----

export type GridGeometry = {
  columns: number;
  tileWidth: number;
  tileHeight: number;
  gap: number;
  // The grid flows right to left (Arabic): the first tile is in the right-most column.
  rtl: boolean;
};

// Where a slot is, in physical pixels from the content box's top-left. In
// right-to-left the columns are mirrored, so "earlier" is to the right.
export function slotOrigin(index: number, g: GridGeometry): { x: number; y: number } {
  const row = Math.floor(index / g.columns);
  const col = index % g.columns;
  const visualCol = g.rtl ? g.columns - 1 - col : col;
  return {
    x: visualCol * (g.tileWidth + g.gap),
    y: row * (g.tileHeight + g.gap),
  };
}

// The slot a physical point (the dragged tile's centre, from the content box's
// top-left) is over. Clamped to the grid, and to the last tile.
export function dropIndex(point: { x: number; y: number }, count: number, g: GridGeometry): number {
  if (count <= 0) return 0;
  const rows = Math.ceil(count / g.columns);
  const visualCol = Math.max(
    0,
    Math.min(g.columns - 1, Math.floor(point.x / (g.tileWidth + g.gap)))
  );
  const col = g.rtl ? g.columns - 1 - visualCol : visualCol;
  const row = Math.max(0, Math.min(rows - 1, Math.floor(point.y / (g.tileHeight + g.gap))));
  return Math.min(count - 1, row * g.columns + col);
}

// The drop slot for a tile at `from` dragged by (dx, dy) from where it started.
export function dropIndexForDrag(
  from: number,
  delta: { dx: number; dy: number },
  count: number,
  g: GridGeometry
): number {
  const start = slotOrigin(from, g);
  return dropIndex(
    {
      x: start.x + delta.dx + g.tileWidth / 2,
      y: start.y + delta.dy + g.tileHeight / 2,
    },
    count,
    g
  );
}

export function contentHeight(count: number, g: GridGeometry): number {
  const rows = Math.ceil(count / g.columns);
  return rows === 0 ? 0 : rows * g.tileHeight + (rows - 1) * g.gap;
}

// ---- Saving ----

export type ArrangementPayload = {
  tabs: { id: string; position: number; visible: boolean }[];
  tiles: { tab_id: string; product_id: string; position: number; hidden: boolean }[];
};

const tileSignature = (tab: ArrangeTab) =>
  tab.tiles.map((t) => `${t.key}:${t.hidden ? 1 : 0}`).join(",");

export function tabsChanged(original: ArrangeTab[], working: ArrangeTab[]): boolean {
  return (
    original.map((t) => `${t.id}:${t.visible ? 1 : 0}`).join(",") !==
    working.map((t) => `${t.id}:${t.visible ? 1 : 0}`).join(",")
  );
}

export function changedTileTabIds(original: ArrangeTab[], working: ArrangeTab[]): string[] {
  const before = new Map(original.map((tab) => [tab.id, tileSignature(tab)]));
  return working.filter((tab) => before.get(tab.id) !== tileSignature(tab)).map((tab) => tab.id);
}

export function hasArrangementChanges(original: ArrangeTab[], working: ArrangeTab[]): boolean {
  return tabsChanged(original, working) || changedTileTabIds(original, working).length > 0;
}

// Null when nothing changed. Tabs are sent whole, in their new order. Tiles are
// sent only for the tabs whose order or hidden flags changed, each as its full
// ordered list: on a category tab that gives every product an explicit place.
export function buildArrangementPayload(
  original: ArrangeTab[],
  working: ArrangeTab[]
): ArrangementPayload | null {
  if (!hasArrangementChanges(original, working)) return null;
  const changed = new Set(changedTileTabIds(original, working));
  return {
    tabs: working.map((tab, position) => ({ id: tab.id, position, visible: tab.visible })),
    tiles: working
      .filter((tab) => changed.has(tab.id))
      .flatMap((tab) =>
        tab.tiles.map((tile, position) => ({
          tab_id: tab.id,
          product_id: tile.key,
          position,
          hidden: tile.hidden,
        }))
      ),
  };
}
