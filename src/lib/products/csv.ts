import Papa from "papaparse";

import { centsToDisplay, parseMoneyToCents, parseQuantity } from "@/src/lib/money";
import type { Category, Product, ProductInput, ProductUnit } from "@/src/lib/products/queries";

export type ImportFieldKey =
  | "name"
  | "barcode"
  | "category"
  | "unit"
  | "selling_price"
  | "cost"
  | "quantity"
  | "low_stock_threshold";

export type ImportField = {
  key: ImportFieldKey;
  label: string;
  required: boolean;
  hint?: string;
};

export const IMPORT_FIELDS: ImportField[] = [
  { key: "name", label: "Name", required: true },
  { key: "barcode", label: "Barcode", required: false },
  { key: "category", label: "Category", required: false, hint: "Must match an existing category" },
  { key: "unit", label: "Unit", required: false, hint: "piece, kg or pack" },
  { key: "selling_price", label: "Selling price", required: true },
  { key: "cost", label: "Buying price", required: false, hint: "Creates an opening delivery" },
  { key: "quantity", label: "Opening stock", required: false, hint: "Needs a buying price" },
  { key: "low_stock_threshold", label: "Low stock threshold", required: false },
];

export type ColumnMapping = Partial<Record<ImportFieldKey, string>>;

export type ParsedRow = {
  rowNumber: number;
  product: ProductInput;
  // Set only when the file carried both a cost and a quantity: stock and cost
  // are never written directly, they come from a purchase so the triggers run.
  opening: { quantity: number; unit_cost_cents: number } | null;
};

export type RowError = { rowNumber: number; messages: string[] };

export type ValidationResult = { rows: ParsedRow[]; errors: RowError[] };

const HEADER_HINTS: Record<ImportFieldKey, string[]> = {
  name: ["name", "nom", "produit", "product", "designation", "libelle"],
  barcode: ["barcode", "code barre", "codebarre", "code-barres", "ean", "gencod", "code"],
  category: ["category", "categorie", "famille", "rayon"],
  unit: ["unit", "unite", "mesure"],
  selling_price: ["selling price", "prix de vente", "prix vente", "prix", "price", "pv", "vente"],
  cost: ["cost", "buying price", "prix achat", "prix d'achat", "achat", "cout", "pa"],
  quantity: ["quantity", "quantite", "qty", "stock", "qte"],
  low_stock_threshold: ["low stock", "seuil", "threshold", "stock mini", "minimum"],
};

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();

  for (const field of IMPORT_FIELDS) {
    const hints = HEADER_HINTS[field.key];
    const match = headers.find((header) => {
      if (used.has(header)) return false;
      const normalized = normalizeHeader(header);
      return hints.some((hint) => normalized === hint || normalized.includes(hint));
    });

    if (match) {
      mapping[field.key] = match;
      used.add(match);
    }
  }

  return mapping;
}

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });

  return {
    headers: result.meta.fields ?? [],
    rows: result.data ?? [],
  };
}

const UNITS: ProductUnit[] = ["piece", "kg", "pack"];

function cell(row: Record<string, string>, column: string | undefined): string {
  if (!column) return "";
  return (row[column] ?? "").trim();
}

export function validateRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  context: { categories: Category[]; existingBarcodes: Set<string> }
): ValidationResult {
  const parsed: ParsedRow[] = [];
  const errors: RowError[] = [];

  const categoriesByName = new Map(
    context.categories.map((category) => [normalizeHeader(category.name), category.id])
  );
  const barcodesInFile = new Set<string>();

  rows.forEach((row, index) => {
    // +2: the header is row 1, so data starts at row 2 in the user's file.
    const rowNumber = index + 2;
    const messages: string[] = [];

    const name = cell(row, mapping.name);
    if (!name) messages.push("Name is required");

    const priceRaw = cell(row, mapping.selling_price);
    const sellingPriceCents = priceRaw ? parseMoneyToCents(priceRaw) : null;
    if (!priceRaw) {
      messages.push("Selling price is required");
    } else if (sellingPriceCents === null) {
      messages.push(`Selling price "${priceRaw}" is not a valid amount`);
    }

    const barcode = cell(row, mapping.barcode) || null;
    if (barcode) {
      if (context.existingBarcodes.has(barcode)) {
        messages.push(`Barcode ${barcode} already exists`);
      } else if (barcodesInFile.has(barcode)) {
        messages.push(`Barcode ${barcode} appears more than once in this file`);
      }
    }

    const unitRaw = normalizeHeader(cell(row, mapping.unit));
    let unit: ProductUnit = "piece";
    if (unitRaw) {
      if (UNITS.includes(unitRaw as ProductUnit)) {
        unit = unitRaw as ProductUnit;
      } else {
        messages.push(`Unit "${unitRaw}" must be piece, kg or pack`);
      }
    }

    const categoryRaw = cell(row, mapping.category);
    let categoryId: string | null = null;
    if (categoryRaw) {
      categoryId = categoriesByName.get(normalizeHeader(categoryRaw)) ?? null;
      if (!categoryId) messages.push(`Unknown category "${categoryRaw}"`);
    }

    const thresholdRaw = cell(row, mapping.low_stock_threshold);
    const threshold = thresholdRaw ? parseQuantity(thresholdRaw) : 0;
    if (thresholdRaw && threshold === null) {
      messages.push(`Low stock threshold "${thresholdRaw}" is not a valid number`);
    }

    const costRaw = cell(row, mapping.cost);
    const quantityRaw = cell(row, mapping.quantity);
    const costCents = costRaw ? parseMoneyToCents(costRaw) : null;
    const quantity = quantityRaw ? parseQuantity(quantityRaw) : null;

    if (costRaw && costCents === null) {
      messages.push(`Buying price "${costRaw}" is not a valid amount`);
    }
    if (quantityRaw && quantity === null) {
      messages.push(`Opening stock "${quantityRaw}" is not a valid number`);
    }
    if (quantity !== null && quantity > 0 && costCents === null) {
      messages.push("Opening stock needs a buying price, otherwise cost would be recorded as zero");
    }

    if (messages.length > 0) {
      errors.push({ rowNumber, messages });
      return;
    }

    if (barcode) barcodesInFile.add(barcode);

    parsed.push({
      rowNumber,
      product: {
        name,
        barcode,
        category_id: categoryId,
        unit,
        selling_price_cents: sellingPriceCents as number,
        low_stock_threshold: threshold ?? 0,
        active: true,
      },
      opening:
        quantity !== null && quantity > 0 && costCents !== null
          ? { quantity, unit_cost_cents: costCents }
          : null,
    });
  });

  return { rows: parsed, errors };
}

export function toCsv(
  products: Product[],
  categories: Category[],
  includeCost: boolean
): string {
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

  const rows = products.map((product) => {
    const row: Record<string, string> = {
      name: product.name,
      barcode: product.barcode ?? "",
      category: product.category_id ? (categoryNames.get(product.category_id) ?? "") : "",
      unit: product.unit,
      selling_price: centsToDisplay(product.selling_price_cents),
      quantity: String(product.stock_quantity),
      low_stock_threshold: String(product.low_stock_threshold),
      active: product.active ? "yes" : "no",
    };

    if (includeCost) {
      row.cost = centsToDisplay(product.current_cost_cents ?? 0);
    }

    return row;
  });

  return Papa.unparse(rows);
}
