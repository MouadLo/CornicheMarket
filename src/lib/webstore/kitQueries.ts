// Data access for the owner's kits of the public webstore (tables web_kits and
// web_kit_items, migration 054). Owner only: RLS refuses anyone else. Every
// UPDATE and DELETE has a filter (the API refuses one without); the lines are
// replaced by the save_web_kit_items function.
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

// Replaces the lines of one kit with `items`, in this order, in ONE call: the
// save_web_kit_items function (migration 059) deletes and inserts in a single
// transaction, so a failure leaves the previous lines untouched. It sets
// sort = position * 10 and refuses (22023) invalid quantities, more than 12
// lines, duplicates and bad ids.
export async function saveKitItems(
  kitId: string,
  items: readonly Pick<WebKitItem, "web_product_id" | "qty">[]
): Promise<void> {
  const { error } = await supabase.rpc("save_web_kit_items", {
    p_kit_id: kitId,
    p_items: items.map((i) => ({ id: i.web_product_id, qty: i.qty })),
  });
  if (error) throw new Error(error.message);
}
