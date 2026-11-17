import { supabase } from "@/src/lib/supabase/client";
import type { GridCategory, GridTab, GridTile } from "@/src/lib/sellGrid/layout";

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
