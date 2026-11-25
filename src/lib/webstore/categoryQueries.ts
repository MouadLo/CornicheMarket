// Data access for the site's categories and sub-categories (migration 054).
// Owner only. Every UPDATE and DELETE has a filter: a sub-category is always
// filtered on BOTH keys (category_id and code), because the same code may exist
// in several categories.
//
// A category or sub-category a product uses cannot be deleted (the foreign key
// has no delete action): the app refuses first, with the number of products,
// and the foreign key error (23503) is turned into the same refusal.
import { supabase } from "@/src/lib/supabase/client";
import { countUsage, type UsageCounts } from "./categories";
import { moveSorts } from "./order";
import type { WebCategory, WebSubcategory } from "./types";

const PAGE = 1000;

export class InUseError extends Error {
  // How many products use it (0 when only the database said so).
  readonly count: number;
  constructor(count: number) {
    super("in use");
    this.name = "InUseError";
    this.count = count;
  }
}

type DbError = { message: string; code?: string };

function fail(error: DbError): never {
  if (error.code === "23503") throw new InUseError(0);
  throw new Error(error.message);
}

// Products per category and per sub-category.
export async function fetchUsageCounts(): Promise<UsageCounts> {
  const rows: { category_id: string; sub_code: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("web_products")
      .select("category_id, sub_code")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as { category_id: string; sub_code: string | null }[];
    rows.push(...page);
    if (page.length < PAGE) return countUsage(rows);
  }
}

async function lastSort(table: "web_categories" | "web_subcategories", categoryId?: string) {
  let query = supabase.from(table).select("sort");
  if (categoryId !== undefined) query = query.eq("category_id", categoryId);
  const { data, error } = await query.order("sort", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { sort: number }[])[0]?.sort ?? -1;
}

export async function createCategory(input: {
  id: string;
  name: string;
  name_fr: string;
  icon: string;
}): Promise<void> {
  const sort = await lastSort("web_categories");
  const { error } = await supabase.from("web_categories").insert({ ...input, sort: sort + 1 });
  if (error) throw new Error(error.message);
}

export async function updateCategory(
  id: string,
  patch: { name?: string; name_fr?: string; icon?: string }
): Promise<void> {
  const { error } = await supabase.from("web_categories").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

// Moves one category up (-1) or down (+1) in `list` (the current order).
export async function moveCategory(
  list: readonly Pick<WebCategory, "id" | "sort">[],
  id: string,
  dir: -1 | 1
): Promise<void> {
  const updates = moveSorts(
    list.map((c) => ({ key: c.id, sort: c.sort })),
    id,
    dir
  );
  for (const u of updates) {
    const { error } = await supabase
      .from("web_categories")
      .update({ sort: u.sort })
      .eq("id", u.key);
    if (error) throw new Error(error.message);
  }
}

// Refuses (InUseError with the count) while products use the category. Its
// sub-categories are deleted with it (on delete cascade).
export async function deleteCategory(id: string): Promise<void> {
  const { count, error: countError } = await supabase
    .from("web_products")
    .select("id", { count: "exact", head: true })
    .eq("category_id", id);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) > 0) throw new InUseError(count ?? 0);
  const { error } = await supabase.from("web_categories").delete().eq("id", id);
  if (error) fail(error);
}

export async function createSub(
  categoryId: string,
  input: { code: string; name: string; name_fr: string }
): Promise<void> {
  const sort = await lastSort("web_subcategories", categoryId);
  const { error } = await supabase
    .from("web_subcategories")
    .insert({ ...input, category_id: categoryId, sort: sort + 1 });
  if (error) throw new Error(error.message);
}

// The code never changes (products point to it).
export async function updateSub(
  categoryId: string,
  code: string,
  patch: { name?: string; name_fr?: string }
): Promise<void> {
  const { error } = await supabase
    .from("web_subcategories")
    .update(patch)
    .eq("category_id", categoryId)
    .eq("code", code);
  if (error) throw new Error(error.message);
}

export async function moveSub(
  categoryId: string,
  list: readonly Pick<WebSubcategory, "code" | "sort">[],
  code: string,
  dir: -1 | 1
): Promise<void> {
  const updates = moveSorts(
    list.map((s) => ({ key: s.code, sort: s.sort })),
    code,
    dir
  );
  for (const u of updates) {
    const { error } = await supabase
      .from("web_subcategories")
      .update({ sort: u.sort })
      .eq("category_id", categoryId)
      .eq("code", u.key);
    if (error) throw new Error(error.message);
  }
}

export async function deleteSub(categoryId: string, code: string): Promise<void> {
  const { count, error: countError } = await supabase
    .from("web_products")
    .select("id", { count: "exact", head: true })
    .eq("category_id", categoryId)
    .eq("sub_code", code);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) > 0) throw new InUseError(count ?? 0);
  const { error } = await supabase
    .from("web_subcategories")
    .delete()
    .eq("category_id", categoryId)
    .eq("code", code);
  if (error) fail(error);
}
