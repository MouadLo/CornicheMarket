import { cleanCategoryName } from "@/src/lib/products/categories";
import { normalizeSearch } from "@/src/lib/products/search";

// The starter category list every owner chooses from, so the same shop type
// gets the same categories whoever sets it up, in any language. A category made
// from here stores its French name plus the stable code below; the app shows it
// in the language in use. A category the owner types himself has no code and
// stays exactly as typed.
//
// Codes are permanent: reports and imports rely on them, so never reuse or
// rename one. A sub-category extends its parent's code with a dot,
// e.g. "beverages.water".

export type CatalogEntry = {
  code: string;
  fr: string;
  en: string;
  ar: string;
  // Not part of every shop (tobacco, pets): offered, but listed last.
  optional?: true;
  // Standard sub-categories; each code is "<parent code>.<name>".
  subs?: readonly CatalogSub[];
};

export type CatalogSub = { code: string; fr: string; en: string; ar: string };

export const CATEGORY_CATALOG: readonly CatalogEntry[] = [
  {
    code: "beverages",
    fr: "Boissons",
    en: "Beverages",
    ar: "المشروبات",
    subs: [
      { code: "beverages.water", fr: "Eaux", en: "Water", ar: "المياه" },
      { code: "beverages.soft_drinks", fr: "Sodas", en: "Soft drinks", ar: "المشروبات الغازية" },
      { code: "beverages.juice", fr: "Jus", en: "Juice", ar: "العصائر" },
      { code: "beverages.coffee_tea", fr: "Café et thé", en: "Coffee & tea", ar: "القهوة والشاي" },
    ],
  },
  {
    code: "dairy_eggs",
    fr: "Produits laitiers et œufs",
    en: "Dairy & eggs",
    ar: "الألبان والبيض",
    subs: [
      { code: "dairy_eggs.milk", fr: "Lait", en: "Milk", ar: "الحليب" },
      { code: "dairy_eggs.yogurt", fr: "Yaourts", en: "Yogurt", ar: "الياغورت" },
      { code: "dairy_eggs.cheese", fr: "Fromages", en: "Cheese", ar: "الأجبان" },
      { code: "dairy_eggs.butter", fr: "Beurre", en: "Butter", ar: "الزبدة" },
      { code: "dairy_eggs.eggs", fr: "Œufs", en: "Eggs", ar: "البيض" },
    ],
  },
  {
    code: "pantry_savory",
    fr: "Épicerie salée",
    en: "Savory pantry",
    ar: "البقالة المالحة",
    subs: [
      { code: "pantry_savory.oil", fr: "Huiles", en: "Oil", ar: "الزيوت" },
      {
        code: "pantry_savory.pasta_rice",
        fr: "Pâtes et riz",
        en: "Pasta & rice",
        ar: "العجائن والأرز",
      },
      {
        code: "pantry_savory.flour_semolina",
        fr: "Farine et semoule",
        en: "Flour & semolina",
        ar: "الدقيق والسميد",
      },
      { code: "pantry_savory.canned", fr: "Conserves", en: "Canned food", ar: "المعلبات" },
      {
        code: "pantry_savory.spices",
        fr: "Épices et sauces",
        en: "Spices & sauces",
        ar: "التوابل والصلصات",
      },
    ],
  },
  {
    code: "pantry_sweet",
    fr: "Épicerie sucrée",
    en: "Sweet pantry",
    ar: "البقالة الحلوة",
    subs: [
      { code: "pantry_sweet.sugar", fr: "Sucre", en: "Sugar", ar: "السكر" },
      { code: "pantry_sweet.breakfast", fr: "Petit-déjeuner", en: "Breakfast", ar: "الفطور" },
      {
        code: "pantry_sweet.jam_honey",
        fr: "Confiture et miel",
        en: "Jam & honey",
        ar: "المربى والعسل",
      },
    ],
  },
  {
    code: "snacks_sweets",
    fr: "Snacks et confiserie",
    en: "Snacks & sweets",
    ar: "الوجبات الخفيفة والحلويات",
    subs: [
      { code: "snacks_sweets.chips", fr: "Chips", en: "Chips", ar: "الشيبس" },
      { code: "snacks_sweets.biscuits", fr: "Biscuits", en: "Biscuits", ar: "البسكويت" },
      { code: "snacks_sweets.chocolate", fr: "Chocolat", en: "Chocolate", ar: "الشوكولاتة" },
      { code: "snacks_sweets.candy", fr: "Bonbons", en: "Sweets", ar: "الحلوى" },
    ],
  },
  {
    code: "bakery",
    fr: "Boulangerie et pâtisserie",
    en: "Bakery & pastry",
    ar: "المخبزة والحلويات",
    subs: [
      { code: "bakery.bread", fr: "Pain", en: "Bread", ar: "الخبز" },
      { code: "bakery.pastry", fr: "Viennoiserie", en: "Pastries", ar: "المعجنات" },
    ],
  },
  {
    code: "produce",
    fr: "Fruits et légumes",
    en: "Fruit & vegetables",
    ar: "الفواكه والخضر",
    subs: [
      { code: "produce.fruit", fr: "Fruits", en: "Fruit", ar: "الفواكه" },
      { code: "produce.vegetables", fr: "Légumes", en: "Vegetables", ar: "الخضر" },
    ],
  },
  {
    code: "meat_fish_deli",
    fr: "Viandes, poissons, charcuterie",
    en: "Meat, fish & deli",
    ar: "اللحوم والأسماك والمجففات",
    subs: [
      { code: "meat_fish_deli.meat", fr: "Viandes", en: "Meat", ar: "اللحوم" },
      { code: "meat_fish_deli.fish", fr: "Poissons", en: "Fish", ar: "الأسماك" },
      { code: "meat_fish_deli.deli", fr: "Charcuterie", en: "Deli", ar: "اللحوم المصنعة" },
    ],
  },
  { code: "frozen", fr: "Surgelés", en: "Frozen", ar: "المجمدات" },
  {
    code: "personal_care",
    fr: "Hygiène et beauté",
    en: "Personal care",
    ar: "النظافة والتجميل",
    subs: [
      { code: "personal_care.hair", fr: "Cheveux", en: "Hair care", ar: "العناية بالشعر" },
      {
        code: "personal_care.oral",
        fr: "Hygiène bucco-dentaire",
        en: "Oral care",
        ar: "العناية بالفم",
      },
      {
        code: "personal_care.body",
        fr: "Savon et douche",
        en: "Soap & shower",
        ar: "الصابون والاستحمام",
      },
    ],
  },
  {
    code: "baby",
    fr: "Bébé",
    en: "Baby",
    ar: "الرضّع",
    subs: [
      { code: "baby.diapers", fr: "Couches", en: "Diapers", ar: "الحفاضات" },
      { code: "baby.baby_food", fr: "Alimentation bébé", en: "Baby food", ar: "أغذية الرضع" },
    ],
  },
  {
    code: "household_cleaning",
    fr: "Entretien et ménage",
    en: "Household cleaning",
    ar: "منتجات التنظيف",
    subs: [
      { code: "household_cleaning.laundry", fr: "Lessive", en: "Laundry", ar: "مساحيق الغسيل" },
      { code: "household_cleaning.dishes", fr: "Vaisselle", en: "Dishwashing", ar: "غسل الأواني" },
      { code: "household_cleaning.surfaces", fr: "Nettoyants", en: "Cleaners", ar: "المنظفات" },
    ],
  },
  {
    code: "home_stationery",
    fr: "Maison et papeterie",
    en: "Home & stationery",
    ar: "المنزل والقرطاسية",
  },
  {
    code: "phone",
    fr: "Téléphonie",
    en: "Phone",
    ar: "الهاتف",
    subs: [
      { code: "phone.topup", fr: "Recharges", en: "Top-ups", ar: "التعبئة" },
      { code: "phone.accessories", fr: "Accessoires", en: "Accessories", ar: "الإكسسوارات" },
    ],
  },
  { code: "other", fr: "Autres", en: "Other", ar: "أخرى" },
  { code: "tobacco", fr: "Tabac", en: "Tobacco", ar: "التبغ", optional: true },
  { code: "pets", fr: "Animaux", en: "Pets", ar: "الحيوانات الأليفة", optional: true },
];

export type CatalogLang = "fr" | "en" | "ar";

export function catalogLang(language: string | undefined): CatalogLang {
  return language === "ar" || language === "en" ? language : "fr";
}

// Main entries and their sub-categories, for lookups by code or by name.
const ALL_ENTRIES: readonly CatalogSub[] = CATEGORY_CATALOG.flatMap((entry) => [
  entry,
  ...(entry.subs ?? []),
]);

export function findCatalogEntry(code: string | null | undefined): CatalogSub | null {
  return ALL_ENTRIES.find((entry) => entry.code === code) ?? null;
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
  const entry = ALL_ENTRIES.find((candidate) =>
    [candidate.fr, candidate.en, candidate.ar].some(
      (known) => normalizeSearch(cleanCategoryName(known)) === key
    )
  );
  return entry ? entry[catalogLang(language)] : name;
}

// The existing category that already stands for this entry: the one with its
// code, else one whose name is the entry's name in any language.
export function existingFor<T extends StoredCategory>(entry: CatalogSub, existing: T[]): T | null {
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

// The standard sub-categories still worth offering under this main category:
// only for a standard parent, and not already in the shop.
export function subSuggestionsFor(
  parent: StoredCategory,
  existing: StoredCategory[]
): CatalogSub[] {
  const entry = CATEGORY_CATALOG.find((candidate) => candidate.code === parent.code);
  return (entry?.subs ?? []).filter((sub) => !existingFor(sub, existing));
}

// "Boissons › Eaux" for a sub-category, the plain label for a main one.
export function categoryPathLabel(
  category: StoredCategory & { parent_id?: string | null },
  all: StoredCategory[],
  language: string | undefined
): string {
  const own = categoryLabel(category, language);
  const parent = category.parent_id ? all.find((c) => c.id === category.parent_id) : undefined;
  return parent ? `${categoryLabel(parent, language)} › ${own}` : own;
}
