import type { ArrangementPayload } from "@/src/lib/sellGrid/arrange";
import { supabase } from "@/src/lib/supabase/client";
import { parseDiversConfig, type DiversConfig } from "@/src/lib/sellGrid/divers";
import { parseDiversSettings, type DiversSettings } from "@/src/lib/sellGrid/diversSettings";
import type { GridCategory, GridTab, GridTile, TileColor } from "@/src/lib/sellGrid/layout";
import {
  TileSettingsError,
  UNORDERED_POSITION,
  type TileSettings,
} from "@/src/lib/sellGrid/tileSettings";

// Everyone signed in may read the layout (it holds no cost data); only the owner
// writes it (RLS), which arrives with the edit mode.
export async function fetchGridLayout(): Promise<{ tabs: GridTab[]; tiles: GridTile[] }> {
  const [tabs, tiles] = await Promise.all([
    supabase
      .from("sell_grid_tabs")
      .select("id, kind, category_id, label, position, visible, auto_fill")
      .order("position"),
    supabase
      .from("sell_grid_tiles")
      .select("id, tab_id, product_id, position, hidden, pinned, color, short_label")
      .order("position"),
  ]);
  if (tabs.error) throw new Error(tabs.error.message);
  if (tiles.error) throw new Error(tiles.error.message);
  return { tabs: (tabs.data ?? []) as GridTab[], tiles: (tiles.data ?? []) as GridTile[] };
}

export async function fetchGridCategories(): Promise<GridCategory[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, parent_id")
    .order("name");
  // 42703: a database without migration 036 has no parent_id; every category is a main one.
  if (error?.code === "42703") {
    const legacy = await supabase.from("categories").select("id, name").order("name");
    if (legacy.error) throw new Error(legacy.error.message);
    return (legacy.data ?? []) as GridCategory[];
  }
  if (error) throw new Error(error.message);
  return (data ?? []) as GridCategory[];
}

// ---- One product's tile settings (O7: owner only; RLS rejects anyone else) ----

type TileRow = { id: string; tab_id: string; color: TileColor | null };

async function favoritesTabId(): Promise<string | null> {
  const { data, error } = await supabase
    .from("sell_grid_tabs")
    .select("id")
    .eq("kind", "favorites")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string } | null)?.id ?? null;
}

async function categoryTabId(categoryId: string | null): Promise<string | null> {
  if (!categoryId) return null;
  const { data, error } = await supabase
    .from("sell_grid_tabs")
    .select("id")
    .eq("kind", "category")
    .eq("category_id", categoryId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string } | null)?.id ?? null;
}

// Is the product a favourite, and which colour does its tile have? The category
// tile's colour wins (it is the one most cashiers see), then the Favorites one.
export async function fetchProductTileSettings(
  productId: string,
  tabCategoryId: string | null
): Promise<TileSettings> {
  const [favTab, catTab] = await Promise.all([favoritesTabId(), categoryTabId(tabCategoryId)]);
  const { data, error } = await supabase
    .from("sell_grid_tiles")
    .select("id, tab_id, color")
    .eq("product_id", productId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as TileRow[];
  const fav = favTab ? rows.find((r) => r.tab_id === favTab) : undefined;
  const cat = catTab ? rows.find((r) => r.tab_id === catTab) : undefined;
  return { favorite: fav !== undefined, color: cat?.color ?? fav?.color ?? null };
}

// Creates the product's row on a tab if it has none (never touching an existing
// one), then sets only its colour. Safe to repeat: the unique (tab, product)
// constraint makes a second insert a no-op.
async function setTileColor(
  tabId: string,
  productId: string,
  color: TileColor | null,
  newPosition: number
) {
  const insert = await supabase
    .from("sell_grid_tiles")
    .upsert(
      { tab_id: tabId, product_id: productId, position: newPosition, color },
      { onConflict: "tab_id,product_id", ignoreDuplicates: true }
    );
  if (insert.error) throw new Error(insert.error.message);
  const update = await supabase
    .from("sell_grid_tiles")
    .update({ color })
    .eq("tab_id", tabId)
    .eq("product_id", productId);
  if (update.error) throw new Error(update.error.message);
}

// Applies the settings to this product's rows only: no other product's tile,
// and no position, pinned, hidden or short label of any tile, is changed.
// Failures are wrapped in TileSettingsError (the product itself is already saved).
export async function saveProductTileSettings(
  productId: string,
  tabCategoryId: string | null,
  settings: TileSettings
): Promise<void> {
  try {
    const [favTab, catTab] = await Promise.all([favoritesTabId(), categoryTabId(tabCategoryId)]);

    if (favTab) {
      if (settings.favorite) {
        const { data, error } = await supabase
          .from("sell_grid_tiles")
          .select("position")
          .eq("tab_id", favTab)
          .order("position", { ascending: false })
          .limit(1);
        if (error) throw new Error(error.message);
        const last = (data as { position: number }[] | null)?.[0]?.position ?? -1;
        await setTileColor(favTab, productId, settings.color, Math.max(last, -1) + 1);
      } else {
        const { error } = await supabase
          .from("sell_grid_tiles")
          .delete()
          .eq("tab_id", favTab)
          .eq("product_id", productId);
        if (error) throw new Error(error.message);
      }
    }

    if (catTab) {
      if (settings.color) {
        await setTileColor(catTab, productId, settings.color, UNORDERED_POSITION);
      } else {
        // Back to the default: a row that only carried a colour goes away; a row
        // that also pins, hides or orders the tile keeps those and loses the colour.
        const cleared = await supabase
          .from("sell_grid_tiles")
          .update({ color: null })
          .eq("tab_id", catTab)
          .eq("product_id", productId);
        if (cleared.error) throw new Error(cleared.error.message);
        const removed = await supabase
          .from("sell_grid_tiles")
          .delete()
          .eq("tab_id", catTab)
          .eq("product_id", productId)
          .eq("position", UNORDERED_POSITION)
          .eq("pinned", false)
          .eq("hidden", false)
          .is("short_label", null);
        if (removed.error) throw new Error(removed.error.message);
      }
    }
  } catch (cause) {
    throw new TileSettingsError(cause);
  }
}

// ---- The owner's arrangement of the whole grid (O7), saved in one call ----

// save_sell_grid_arrangement (migration 044): tab order and visibility, and the
// order and hidden flag of the tiles of each tab arranged, in one transaction.
// Throws the Supabase error as it is, so errorKey() can say why (42501: not the owner).
export async function saveGridArrangement(payload: ArrangementPayload): Promise<void> {
  const { error } = await supabase.rpc("save_sell_grid_arrangement", {
    p_tabs: payload.tabs,
    p_tiles: payload.tiles,
  });
  if (error) throw error;
}

// ---- Divers (the built-in free-amount item) ----

// The Divers product's id and the cashier's maximum, for the amount pad. Both
// are readable by everyone signed in (the cashier view of products and
// store_settings hold no cost). Null when the database has no Divers product
// yet: the tile is then not offered. Throws on a read error, so a failed
// refresh keeps the last known value instead of erasing it.
export async function fetchDiversConfig(): Promise<DiversConfig | null> {
  const [product, settings] = await Promise.all([
    supabase.from("products_cashier_view").select("id").eq("kind", "misc").maybeSingle(),
    supabase.from("store_settings").select("divers_max_cents").eq("singleton", true).maybeSingle(),
  ]);
  if (product.error) throw new Error(product.error.message);
  if (settings.error) throw new Error(settings.error.message);
  const id = (product.data as { id: string } | null)?.id;
  if (!id) return null;
  return parseDiversConfig({
    productId: id,
    maxCents: (settings.data as { divers_max_cents: number } | null)?.divers_max_cents,
  });
}

// Owner only (Settings). The margin lives in owner_settings, which cashiers
// cannot read (RLS), so it never reaches a cashier device.
export async function fetchDiversSettings(): Promise<DiversSettings> {
  const [store, owner] = await Promise.all([
    supabase.from("store_settings").select("divers_max_cents").eq("singleton", true).maybeSingle(),
    supabase
      .from("owner_settings")
      .select("divers_margin_percent")
      .eq("singleton", true)
      .maybeSingle(),
  ]);
  if (store.error) throw new Error(store.error.message);
  if (owner.error) throw new Error(owner.error.message);
  return parseDiversSettings(
    store.data as Record<string, unknown> | null,
    owner.data as Record<string, unknown> | null
  );
}

export async function updateDiversSettings(settings: DiversSettings): Promise<void> {
  const store = await supabase
    .from("store_settings")
    .update({ divers_max_cents: settings.maxCents })
    .eq("singleton", true);
  if (store.error) throw new Error(store.error.message);
  const owner = await supabase
    .from("owner_settings")
    .update({ divers_margin_percent: settings.marginPercent })
    .eq("singleton", true);
  if (owner.error) throw new Error(owner.error.message);
}
