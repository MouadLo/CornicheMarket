// Data access for the owner's kits of the public webstore (tables web_kits and
// web_kit_items, migration 054). Owner only: RLS refuses anyone else. Every
// UPDATE and DELETE has a filter (the API refuses one without).
import { supabase } from "@/src/lib/supabase/client";
import { orderedItems, orderedKits } from "./kits";
import type { NewWebKit, WebKit, WebKitItem, WebKitPatch } from "./types";

const KIT_COLUMNS =
  "id, name, name_fr, published, sort, items:web_kit_items(web_product_id, qty, sort)";

// The kits in the feed's order (sort, then id), their lines in the feed's order.
export async function fetchKits(): Promise<WebKit[]> {
  const { data, error } = await supabase.from("web_kits").select(KIT_COLUMNS);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as WebKit[];
  return orderedKits(rows.map((k) => ({ ...k, items: orderedItems(k.items ?? []) })));
}

// Inserts at the end of the owner's order (the default sort 0 would put a new
// kit first on the site).
export async function createKit(input: NewWebKit): Promise<void> {
  const { data: last, error: sortError } = await supabase
    .from("web_kits")
    .select("sort")
    .order("sort", { ascending: false })
    .limit(1);
  if (sortError) throw new Error(sortError.message);
  const sort = ((last ?? []) as { sort: number }[])[0]?.sort ?? -1;
  const { error } = await supabase.from("web_kits").insert({
    id: input.id,
    name: input.name,
    name_fr: input.name_fr,
    published: input.published,
    sort: sort + 1,
  });
  if (error) throw new Error(error.message);
}

export async function updateKit(id: string, patch: WebKitPatch): Promise<void> {
  const { error } = await supabase.from("web_kits").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export function setKitPublished(id: string, published: boolean): Promise<void> {
  return updateKit(id, { published });
}

// Deleting a kit deletes its lines (on delete cascade).
export async function deleteKit(id: string): Promise<void> {
  const { error } = await supabase.from("web_kits").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

const toRows = (kitId: string, items: readonly Pick<WebKitItem, "web_product_id" | "qty">[]) =>
  items.map((item, index) => ({
    kit_id: kitId,
    web_product_id: item.web_product_id,
    qty: item.qty,
    sort: index * 10,
  }));

// Replaces the lines of one kit with `items`, in this order (sort = index * 10):
// deletes the kit's lines, then inserts the new ones. Not atomic: when the
// insert fails, the previous lines are put back (best effort) before the error
// is thrown.
export async function saveKitItems(
  kitId: string,
  items: readonly Pick<WebKitItem, "web_product_id" | "qty">[],
  previous: readonly Pick<WebKitItem, "web_product_id" | "qty">[] = []
): Promise<void> {
  const removed = await supabase.from("web_kit_items").delete().eq("kit_id", kitId);
  if (removed.error) throw new Error(removed.error.message);
  if (items.length === 0) return;
  const inserted = await supabase.from("web_kit_items").insert(toRows(kitId, items));
  if (inserted.error) {
    if (previous.length > 0) {
      await supabase.from("web_kit_items").insert(toRows(kitId, previous));
    }
    throw new Error(inserted.error.message);
  }
}
