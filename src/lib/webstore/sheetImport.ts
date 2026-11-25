// Turns the owner's Google Sheet feed into one SQL transaction that fills the
// web_* tables (migration 054). Pure: no Supabase, no files, no network.
//
// Relative imports carry a ".ts" extension so Node can run the CLI in
// scripts/webstore-import.ts directly (native type stripping).
import { parseMoneyToCents } from "../money.ts";

export type SheetSub = { id: string; name: string; name_fr?: string | null };
export type SheetCategory = {
  id: string;
  name: string;
  name_fr?: string | null;
  icon?: string | null;
  subs?: SheetSub[] | null;
};
export type SheetProduct = {
  id: string;
  name: string;
  name_fr?: string | null;
  size?: string | null;
  cat: string;
  sub?: string | null;
  price?: number | string | null;
  stock?: boolean;
  popular?: boolean;
  image?: string | null;
  keywords?: string | null;
};
export type SheetKitItem = { id: string; qty: number };
export type SheetKit = {
  id: string;
  name: string;
  name_fr?: string | null;
  items: SheetKitItem[];
};
export type SheetFeed = {
  version?: number;
  generated_at?: string;
  categories: SheetCategory[];
  products: SheetProduct[];
  kits: SheetKit[];
};

export type Validation = { feed: SheetFeed | null; errors: string[]; warnings: string[] };

// Mirrors the CHECK constraints of migration 054.
const CATEGORY_ID = /^[a-z][a-z0-9]{1,19}$/;
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,20}$/;
const KIT_ID = /^[A-Za-z0-9_-]{1,40}$/;
const NAME_MAX = 120;
const KIT_NAME_MAX = 60;
const SUB_CODE_MAX = 40;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Strings the database cannot store (Postgres text rejects NUL).
const hasNul = (s: string) => s.includes("\u0000");

function text(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// The price as integer centimes, never through `price * 100`.
export function priceToCents(price: unknown): number | null {
  if (price === null || price === undefined || price === "") return null;
  if (typeof price !== "number" && typeof price !== "string") return null;
  if (typeof price === "number" && !Number.isFinite(price)) return null;
  return parseMoneyToCents(String(price));
}

export function validateSheetFeed(json: unknown): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(json)) {
    return { feed: null, errors: ["the feed is not a JSON object"], warnings };
  }
  for (const key of ["categories", "products", "kits"] as const) {
    if (!Array.isArray(json[key])) errors.push(`"${key}" is missing or not a list`);
  }
  if (errors.length > 0) return { feed: null, errors, warnings };

  const categories = json.categories as unknown[];
  const products = json.products as unknown[];
  const kits = json.kits as unknown[];

  const checkName = (where: string, value: unknown, max: number, required: boolean) => {
    if (value === null || value === undefined || value === "") {
      if (required) errors.push(`${where}: name is empty`);
      return;
    }
    if (typeof value !== "string") {
      errors.push(`${where}: name is not text`);
      return;
    }
    if (value.length > max)
      errors.push(`${where}: name is ${value.length} characters (max ${max})`);
    if (hasNul(value)) errors.push(`${where}: name contains a NUL character`);
  };

  // Categories and their subs
  const categoryIds = new Set<string>();
  const subsByCategory = new Map<string, Set<string>>();
  for (const [i, raw] of categories.entries()) {
    if (!isObject(raw)) {
      errors.push(`category #${i + 1}: not an object`);
      continue;
    }
    const id = text(raw.id);
    const label = `category ${id ?? `#${i + 1}`}`;
    if (id === null || !CATEGORY_ID.test(id)) {
      errors.push(`${label}: id must match ${CATEGORY_ID}`);
      continue;
    }
    if (categoryIds.has(id)) warnings.push(`${label}: duplicate id, the last one wins`);
    categoryIds.add(id);
    checkName(label, raw.name, NAME_MAX, true);
    checkName(`${label} (fr)`, raw.name_fr, NAME_MAX, false);
    if (raw.name_fr === undefined || raw.name_fr === null || raw.name_fr === "") {
      warnings.push(`${label}: no name_fr, the English name is used`);
    }
    const subs = new Set<string>();
    subsByCategory.set(id, subs);
    const rawSubs = raw.subs ?? [];
    if (!Array.isArray(rawSubs)) {
      errors.push(`${label}: subs is not a list`);
      continue;
    }
    for (const [j, s] of rawSubs.entries()) {
      if (!isObject(s)) {
        errors.push(`${label}: sub #${j + 1} is not an object`);
        continue;
      }
      const code = text(s.id);
      const subLabel = `${label} sub ${code ?? `#${j + 1}`}`;
      if (code === null || code.length < 1 || code.length > SUB_CODE_MAX || hasNul(code)) {
        errors.push(`${subLabel}: id must be 1 to ${SUB_CODE_MAX} characters`);
        continue;
      }
      if (subs.has(code)) warnings.push(`${subLabel}: duplicate id, the last one wins`);
      subs.add(code);
      checkName(subLabel, s.name, NAME_MAX, true);
      checkName(`${subLabel} (fr)`, s.name_fr, NAME_MAX, false);
    }
  }

  // Products
  const productIds = new Set<string>();
  for (const [i, raw] of products.entries()) {
    if (!isObject(raw)) {
      errors.push(`product #${i + 1}: not an object`);
      continue;
    }
    const id = text(raw.id);
    const label = `product ${id ?? `#${i + 1}`}`;
    if (id === null || !PRODUCT_ID.test(id)) {
      errors.push(`${label}: id must match ${PRODUCT_ID}`);
      continue;
    }
    if (productIds.has(id)) warnings.push(`${label}: duplicate id, the last one wins`);
    productIds.add(id);
    checkName(label, raw.name, NAME_MAX, true);
    checkName(`${label} (fr)`, raw.name_fr, NAME_MAX, false);
    for (const field of ["size", "keywords"] as const) {
      const v = raw[field];
      if (v !== null && v !== undefined && (typeof v !== "string" || hasNul(v))) {
        errors.push(`${label}: ${field} is not valid text`);
      }
    }
    const cat = text(raw.cat);
    if (cat === null || !categoryIds.has(cat)) {
      errors.push(`${label}: category "${String(raw.cat)}" is not in the categories list`);
    } else if (raw.sub !== null && raw.sub !== undefined && raw.sub !== "") {
      if (typeof raw.sub !== "string" || !subsByCategory.get(cat)?.has(raw.sub)) {
        warnings.push(
          `${label}: sub "${String(raw.sub)}" is not a sub of "${cat}", imported without sub`
        );
      }
    }
    const image = raw.image;
    if (image !== null && image !== undefined && image !== "") {
      if (typeof image !== "string" || !/^https:\/\//.test(image) || hasNul(image)) {
        errors.push(`${label}: image must be an https:// URL`);
      }
    }
    const price = raw.price;
    if (price === null || price === undefined || price === "") {
      warnings.push(`${label}: no price (shown as "prix à confirmer")`);
    } else {
      const cents = priceToCents(price);
      if (cents === null || cents < 0)
        errors.push(`${label}: price "${String(price)}" is not a valid amount`);
    }
    if (raw.stock !== undefined && typeof raw.stock !== "boolean") {
      errors.push(`${label}: stock must be true or false`);
    }
    if (raw.popular !== undefined && typeof raw.popular !== "boolean") {
      errors.push(`${label}: popular must be true or false`);
    }
  }

  // Kits
  const kitIds = new Set<string>();
  for (const [i, raw] of kits.entries()) {
    if (!isObject(raw)) {
      errors.push(`kit #${i + 1}: not an object`);
      continue;
    }
    const id = text(raw.id);
    const label = `kit ${id ?? `#${i + 1}`}`;
    if (id === null || !KIT_ID.test(id)) {
      errors.push(`${label}: id must match ${KIT_ID}`);
      continue;
    }
    if (kitIds.has(id)) warnings.push(`${label}: duplicate id, the last one wins`);
    kitIds.add(id);
    checkName(label, raw.name, KIT_NAME_MAX, true);
    checkName(`${label} (fr)`, raw.name_fr, KIT_NAME_MAX, false);
    if (!Array.isArray(raw.items)) {
      errors.push(`${label}: items is not a list`);
      continue;
    }
    const seen = new Set<string>();
    for (const [j, it] of raw.items.entries()) {
      if (!isObject(it)) {
        errors.push(`${label}: item #${j + 1} is not an object`);
        continue;
      }
      const itemId = text(it.id);
      if (itemId === null || itemId === "" || hasNul(itemId)) {
        errors.push(`${label}: item #${j + 1} has no id`);
        continue;
      }
      if (typeof it.qty !== "number" || !Number.isInteger(it.qty) || it.qty < 1 || it.qty > 10) {
        errors.push(`${label}: item ${itemId} qty must be a whole number from 1 to 10`);
      }
      if (seen.has(itemId))
        warnings.push(`${label}: item ${itemId} appears twice, the last one wins`);
      seen.add(itemId);
      if (!productIds.has(itemId)) {
        warnings.push(`${label}: item ${itemId} is not in the products list (kept as is)`);
      }
    }
    if (raw.items.length > 12) {
      warnings.push(`${label}: ${raw.items.length} items, the feed only shows the first 12`);
    }
  }

  if (errors.length > 0) return { feed: null, errors, warnings };
  return { feed: json as unknown as SheetFeed, errors, warnings };
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

// A text literal. Under standard_conforming_strings (set explicitly in the
// script) the only special character inside '...' is the quote, so doubling it
// is complete; backslashes and "$$" are plain characters.
export function sqlLiteral(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("cannot write a non-finite number");
    return String(value);
  }
  if (value.includes("\u0000")) throw new Error("cannot write a NUL character");
  return `'${value.replace(/'/g, "''")}'`;
}

const orNull = (v: string | null | undefined) =>
  v === undefined || v === null || v === "" ? null : v;

// Last occurrence wins, position of the first occurrence is kept.
function dedupe<T>(rows: T[], key: (row: T) => string): T[] {
  const map = new Map<string, T>();
  for (const row of rows) map.set(key(row), row);
  return [...map.values()];
}

function insertStatement(
  table: string,
  columns: string[],
  rows: string[][],
  conflict: string,
  updates: string[]
): string {
  const values = rows.map((r) => `  (${r.join(", ")})`).join(",\n");
  const set = updates.map((c) => `${c} = excluded.${c}`).join(", ");
  return `insert into public.${table} (${columns.join(", ")}) values\n${values}\non conflict (${conflict}) do update set ${set};`;
}

// One transaction. Safe to run again: sheet fields are refreshed, but
// product_id, stock_mode and published are never touched on an existing row,
// and rows that are not in the sheet are left alone.
export function buildImportSql(feed: SheetFeed): string {
  const lit = sqlLiteral;
  const out: string[] = [
    "-- Webstore import from the sheet feed. Generated by scripts/webstore-import.ts.",
    "-- Re-runnable: never overwrites product_id, stock_mode or published of an existing row.",
    "begin;",
    "set local standard_conforming_strings = on;",
  ];

  const categories = dedupe(feed.categories, (c) => c.id);
  if (categories.length > 0) {
    out.push(
      insertStatement(
        "web_categories",
        ["id", "name", "name_fr", "icon", "sort"],
        categories.map((c, i) => [
          lit(c.id),
          lit(c.name),
          lit(orNull(c.name_fr) ?? c.name),
          lit(orNull(c.icon) ?? "bag"),
          lit(i * 10),
        ]),
        "id",
        ["name", "name_fr", "icon", "sort"]
      )
    );
  }

  const subRows: string[][] = [];
  const subs = dedupe(
    categories.flatMap((c) => (c.subs ?? []).map((s, i) => ({ category: c, sub: s, index: i }))),
    (x) => `${x.category.id}\u0000${x.sub.id}`
  );
  for (const { category, sub, index } of subs) {
    subRows.push([
      lit(category.id),
      lit(sub.id),
      lit(sub.name),
      lit(orNull(sub.name_fr) ?? sub.name),
      lit(index * 10),
    ]);
  }
  if (subRows.length > 0) {
    out.push(
      insertStatement(
        "web_subcategories",
        ["category_id", "code", "name", "name_fr", "sort"],
        subRows,
        "category_id, code",
        ["name", "name_fr", "sort"]
      )
    );
  }

  const subCodes = new Map<string, Set<string>>();
  for (const c of categories) subCodes.set(c.id, new Set((c.subs ?? []).map((s) => s.id)));

  const products = dedupe(feed.products, (p) => p.id);
  if (products.length > 0) {
    out.push(
      insertStatement(
        "web_products",
        [
          "id",
          "name",
          "name_fr",
          "size",
          "category_id",
          "sub_code",
          "popular",
          "keywords",
          "image_url",
          "price_cents",
          "manual_in_stock",
          "published",
          "sort",
        ],
        products.map((p, i) => {
          const sub = orNull(p.sub);
          const subOk = sub !== null && subCodes.get(p.cat)?.has(sub);
          return [
            lit(p.id),
            lit(p.name),
            lit(orNull(p.name_fr)),
            lit(orNull(p.size)),
            lit(p.cat),
            lit(subOk ? sub : null),
            lit(p.popular === true),
            lit(orNull(p.keywords)),
            lit(orNull(p.image)),
            lit(priceToCents(p.price)),
            lit(p.stock !== false),
            "true",
            lit(i * 10),
          ];
        }),
        "id",
        [
          "name",
          "name_fr",
          "size",
          "category_id",
          "sub_code",
          "popular",
          "keywords",
          "image_url",
          "price_cents",
          "manual_in_stock",
          "sort",
        ]
      )
    );
  }

  const kits = dedupe(feed.kits, (k) => k.id);
  if (kits.length > 0) {
    out.push(
      insertStatement(
        "web_kits",
        ["id", "name", "name_fr", "sort"],
        kits.map((k, i) => [lit(k.id), lit(k.name), lit(orNull(k.name_fr)), lit(i * 10)]),
        "id",
        ["name", "name_fr", "sort"]
      )
    );
    // The sheet owns the contents of the kits it lists: replace them.
    out.push(
      `delete from public.web_kit_items where kit_id in (${kits.map((k) => lit(k.id)).join(", ")});`
    );
    const items = dedupe(
      kits.flatMap((k) =>
        k.items.map((it, i) => ({ kit: k.id, id: it.id, qty: it.qty, sort: i * 10 }))
      ),
      (x) => `${x.kit}\u0000${x.id}`
    );
    if (items.length > 0) {
      out.push(
        insertStatement(
          "web_kit_items",
          ["kit_id", "web_product_id", "qty", "sort"],
          items.map((x) => [lit(x.kit), lit(x.id), lit(x.qty), lit(x.sort)]),
          "kit_id, web_product_id",
          ["qty", "sort"]
        )
      );
    }
  }

  out.push("commit;", "");
  return out.join("\n");
}
