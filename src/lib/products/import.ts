import type { ParsedRow, RowError } from "@/src/lib/products/csv";
import { supabase } from "@/src/lib/supabase/client";

const CHUNK_SIZE = 200;

export type ImportResult = {
  inserted: number;
  openingLines: number;
  errors: RowError[];
};

export async function importProducts(rows: ParsedRow[], ownerId: string): Promise<ImportResult> {
  const errors: RowError[] = [];
  const openingItems: { product_id: string; quantity: number; unit_cost_cents: number }[] = [];
  let inserted = 0;

  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE);

    const { data, error } = await supabase
      .from("products")
      .insert(chunk.map((row) => row.product))
      .select("id");

    if (error) {
      chunk.forEach((row) => errors.push({ rowNumber: row.rowNumber, messages: [error.message] }));
      continue;
    }

    // Postgres RETURNING preserves the order of the inserted VALUES list, so
    // the ids line up with the chunk rows one for one.
    const ids = (data ?? []) as { id: string }[];
    inserted += ids.length;

    chunk.forEach((row, index) => {
      const id = ids[index]?.id;
      if (id && row.opening) {
        openingItems.push({
          product_id: id,
          quantity: row.opening.quantity,
          unit_cost_cents: row.opening.unit_cost_cents,
        });
      }
    });
  }

  if (openingItems.length > 0) {
    const { data: purchase, error: purchaseError } = await supabase
      .from("purchases")
      .insert({ created_by: ownerId, notes: "CSV import: opening stock" })
      .select("id")
      .single();

    if (purchaseError) {
      errors.push({
        rowNumber: 0,
        messages: [`Products were created but opening stock failed: ${purchaseError.message}`],
      });
      return { inserted, openingLines: 0, errors };
    }

    const purchaseId = (purchase as { id: string }).id;

    for (let start = 0; start < openingItems.length; start += CHUNK_SIZE) {
      const chunk = openingItems.slice(start, start + CHUNK_SIZE);
      const { error: itemsError } = await supabase
        .from("purchase_items")
        .insert(chunk.map((item) => ({ ...item, purchase_id: purchaseId })));

      if (itemsError) {
        errors.push({
          rowNumber: 0,
          messages: [`Opening stock for ${chunk.length} products failed: ${itemsError.message}`],
        });
      }
    }
  }

  return { inserted, openingLines: openingItems.length, errors };
}

export async function fetchExistingBarcodes(): Promise<Set<string>> {
  const barcodes = new Set<string>();
  const pageSize = 1000;

  for (let page = 0; ; page += 1) {
    const { data, error } = await supabase
      .from("products")
      .select("barcode")
      .not("barcode", "is", null)
      .range(page * pageSize, page * pageSize + pageSize - 1);

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as { barcode: string }[];
    rows.forEach((row) => barcodes.add(row.barcode));
    if (rows.length < pageSize) break;
  }

  return barcodes;
}
