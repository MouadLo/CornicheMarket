// What the Sell screen shows, as pure functions (docs/SELL-GRID-DESIGN.md 2.4, 2.6).
// resolveGrid turns the stored layout plus the product cache into tabs of tiles
// and owns every edge case, so the screen only renders.

export type TileColor = "green" | "teal" | "blue" | "indigo" | "purple" | "red" | "amber" | "grey";

export type GridTab = {
  id: string;
  kind: "favorites" | "category";
  category_id: string | null;
  label: string | null;
  position: number;
  visible: boolean;
  auto_fill: boolean;
};

export type GridTile = {
  id: string;
  tab_id: string;
  product_id: string;
  position: number;
  hidden: boolean;
  pinned: boolean;
  color: TileColor | null;
  short_label: string | null;
};

export type GridProduct = {
  id: string;
  name: string;
  barcode: string | null;
  category_id: string | null;
  unit: string;
  selling_price_cents: number;
  stock_quantity: number;
  low_stock_threshold: number;
  active: boolean;
};

export type GridCategory = { id: string; name: string };

export type ResolvedTile = {
  key: string;
  product: GridProduct;
  label: string;
  color: TileColor | null;
};

export type ResolvedTab = {
  id: string;
  kind: GridTab["kind"];
  label: string;
  categoryId: string | null;
  tiles: ResolvedTile[];
};

const byName = (a: GridProduct, b: GridProduct) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);

function tileFor(product: GridProduct, row: GridTile | undefined): ResolvedTile {
  return {
    key: product.id,
    product,
    label: row?.short_label?.trim() || product.name,
    color: row?.color ?? null,
  };
}

export function resolveGrid(input: {
  tabs: GridTab[];
  tiles: GridTile[];
  products: GridProduct[];
  categories: GridCategory[];
  favoritesLabel: string;
}): ResolvedTab[] {
  const active = input.products.filter((p) => p.active);
  const productById = new Map(active.map((p) => [p.id, p]));
  const categoryName = new Map(input.categories.map((c) => [c.id, c.name]));
  const rowsByTab = new Map<string, GridTile[]>();
  for (const row of input.tiles) {
    const list = rowsByTab.get(row.tab_id) ?? [];
    list.push(row);
    rowsByTab.set(row.tab_id, list);
  }
  const byPosition = (a: GridTile, b: GridTile) =>
    a.position - b.position || a.id.localeCompare(b.id);

  const resolved: ResolvedTab[] = [];
  for (const tab of [...input.tabs].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id)
  )) {
    if (!tab.visible) continue;
    const rows = (rowsByTab.get(tab.id) ?? []).sort(byPosition);
    let tiles: ResolvedTile[];

    if (tab.kind === "favorites") {
      // Hand-picked only, in the owner's order. A pick whose product is gone or
      // inactive is simply not shown (the row is kept: reactivating restores it).
      tiles = rows.flatMap((row) => {
        const product = productById.get(row.product_id);
        return product ? [tileFor(product, row)] : [];
      });
    } else {
      // Auto-filled from the category. Overrides for products that have since
      // moved to another category no longer apply.
      const inCategory = active.filter((p) => p.category_id === tab.category_id);
      const own = new Map(
        rows
          .filter((r) => productById.get(r.product_id)?.category_id === tab.category_id)
          .map((r) => [r.product_id, r])
      );
      const hidden = new Set([...own.values()].filter((r) => r.hidden).map((r) => r.product_id));
      const shown = inCategory.filter((p) => !hidden.has(p.id));
      const pinned = [...own.values()].filter((r) => r.pinned && !r.hidden).sort(byPosition);
      const placed = [...own.values()].filter((r) => !r.pinned && !r.hidden).sort(byPosition);
      const placedIds = new Set([...pinned, ...placed].map((r) => r.product_id));
      const rest = shown.filter((p) => !placedIds.has(p.id)).sort(byName);
      tiles = [
        ...pinned.map((r) => tileFor(productById.get(r.product_id)!, r)),
        ...placed.map((r) => tileFor(productById.get(r.product_id)!, r)),
        ...rest.map((p) => tileFor(p, own.get(p.id))),
      ];
    }

    if (tiles.length === 0) continue; // an empty tab is not shown
    resolved.push({
      id: tab.id,
      kind: tab.kind,
      label:
        tab.label?.trim() ||
        (tab.kind === "favorites"
          ? input.favoritesLabel
          : (categoryName.get(tab.category_id ?? "") ?? "")),
      categoryId: tab.category_id,
      tiles,
    });
  }
  return resolved;
}

// A tile is tappable in every state (decision 2): selling past zero is allowed
// and already reported, never blocked. The badge only says what is on the shelf.
export type StockLevel = "ok" | "low" | "out";
export function stockLevel(stock: number, lowThreshold: number): StockLevel {
  if (stock <= 0) return "out";
  if (stock <= lowThreshold) return "low";
  return "ok";
}

// How many tile columns fit a pane (tiles are at least 124 dp wide, gaps 10).
export function tileColumns(paneWidth: number, minTile = 124, gap = 10): number {
  return Math.max(2, Math.floor((paneWidth + gap) / (minTile + gap)));
}

// Grid and cart side by side from 900 dp (tablet and laptop); stacked below.
export const SPLIT_BREAKPOINT = 900;
export function sellLayoutFor(width: number): "split" | "stacked" {
  return width >= SPLIT_BREAKPOINT ? "split" : "stacked";
}
