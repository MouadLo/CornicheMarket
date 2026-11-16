import { cleanCategoryName } from "@/src/lib/products/categories";
import { normalizeSearch } from "@/src/lib/products/search";

// The starter category list every owner chooses from, so the same shop type
// gets the same categories whoever sets it up, in any language. A category made
// from here stores its French name plus the stable code below; the app shows it
// in the language in use. A category the owner types himself has no code and
// stays exactly as typed.
//
// Codes are permanent: reports and imports rely on them, so never reuse or
// rename one. Sub-categories (a later step) will extend a code with a dot,
// e.g. "beverages.water".

export type CatalogEntry = {
  code: string;
  fr: string;
  en: string;
  ar: string;
  // Not part of every shop (tobacco, pets): offered, but listed last.
  optional?: true;
};

export const CATEGORY_CATALOG: readonly CatalogEntry[] = [
  { code: "beverages", fr: "Boissons", en: "Beverages", ar: "المشروبات" },
  { code: "dairy_eggs", fr: "Produits laitiers et œufs", en: "Dairy & eggs", ar: "الألبان والبيض" },
  { code: "pantry_savory", fr: "Épicerie salée", en: "Savory pantry", ar: "البقالة المالحة" },
  { code: "pantry_sweet", fr: "Épicerie sucrée", en: "Sweet pantry", ar: "البقالة الحلوة" },
  {
    code: "snacks_sweets",
    fr: "Snacks et confiserie",
    en: "Snacks & sweets",
    ar: "الوجبات الخفيفة والحلويات",
  },
  {
    code: "bakery",
    fr: "Boulangerie et pâtisserie",
    en: "Bakery & pastry",
    ar: "المخبزة والحلويات",
  },
  { code: "produce", fr: "Fruits et légumes", en: "Fruit & vegetables", ar: "الفواكه والخضر" },
  {
    code: "meat_fish_deli",
    fr: "Viandes, poissons, charcuterie",
    en: "Meat, fish & deli",
    ar: "اللحوم والأسماك والمجففات",
  },
  { code: "frozen", fr: "Surgelés", en: "Frozen", ar: "المجمدات" },
  { code: "personal_care", fr: "Hygiène et beauté", en: "Personal care", ar: "النظافة والتجميل" },
  { code: "baby", fr: "Bébé", en: "Baby", ar: "الرضّع" },
  {
    code: "household_cleaning",
    fr: "Entretien et ménage",
    en: "Household cleaning",
    ar: "منتجات التنظيف",
  },
  {
    code: "home_stationery",
    fr: "Maison et papeterie",
    en: "Home & stationery",
    ar: "المنزل والقرطاسية",
  },
  { code: "phone", fr: "Téléphonie", en: "Phone", ar: "الهاتف" },
  { code: "other", fr: "Autres", en: "Other", ar: "أخرى" },
  { code: "tobacco", fr: "Tabac", en: "Tobacco", ar: "التبغ", optional: true },
  { code: "pets", fr: "Animaux", en: "Pets", ar: "الحيوانات الأليفة", optional: true },
];

export type CatalogLang = "fr" | "en" | "ar";

export function catalogLang(language: string | undefined): CatalogLang {
  return language === "ar" || language === "en" ? language : "fr";
}

export function findCatalogEntry(code: string | null | undefined): CatalogEntry | null {
  return CATEGORY_CATALOG.find((entry) => entry.code === code) ?? null;
}

// A category as stored: the name (French for catalogue entries) and its code.
export type StoredCategory = { id: string; name: string; code?: string | null };

// What to show for a stored category in this language: the catalogue name when
// it has a code, or when its name is one the catalogue knows (an older category
// the owner typed as "Boissons" or "Beverages"); otherwise exactly as typed.
export function categoryLabel(
  category: { name: string; code?: string | null },
  language: string | undefined
): string {
  const lang = catalogLang(language);
  const byCode = findCatalogEntry(category.code);
  if (byCode) return byCode[lang];
  return localizeCategoryName(category.name, language);
}

// For places that only have a name (reports): a name the catalogue knows, in
// any of its three languages, is shown in the language in use.
export function localizeCategoryName(name: string, language: string | undefined): string {
  const key = normalizeSearch(cleanCategoryName(name));
  const entry = CATEGORY_CATALOG.find((candidate) =>
    [candidate.fr, candidate.en, candidate.ar].some(
      (known) => normalizeSearch(cleanCategoryName(known)) === key
    )
  );
  return entry ? entry[catalogLang(language)] : name;
}

// The existing category that already stands for this entry: the one with its
// code, else one whose name is the entry's name in any language.
export function existingFor<T extends StoredCategory>(
  entry: CatalogEntry,
  existing: T[]
): T | null {
  const byCode = existing.find((category) => category.code === entry.code);
  if (byCode) return byCode;
  const names = [entry.fr, entry.en, entry.ar].map((n) => normalizeSearch(cleanCategoryName(n)));
  return (
    existing.find(
      (category) =>
        !category.code && names.includes(normalizeSearch(cleanCategoryName(category.name)))
    ) ?? null
  );
}

// The entries still worth offering: not already in use. Common ones first.
export function suggestionsFor(existing: StoredCategory[]): CatalogEntry[] {
  return CATEGORY_CATALOG.filter((entry) => !existingFor(entry, existing));
}
