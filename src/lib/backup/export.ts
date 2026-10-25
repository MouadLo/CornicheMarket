import AsyncStorage from '@react-native-async-storage/async-storage';
import Papa from 'papaparse';

import { saveTextFile } from '@/src/lib/files';
import { supabase } from '@/src/lib/supabase/client';

const LAST_BACKUP_KEY = '@corniche/lastBackupAt';

export async function getLastBackupTime(): Promise<Date | null> {
  try {
    const val = await AsyncStorage.getItem(LAST_BACKUP_KEY);
    return val ? new Date(val) : null;
  } catch {
    return null;
  }
}

async function markBackupDone() {
  try {
    await AsyncStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
  } catch {}
}

function toCsvBlob<T extends Record<string, unknown>>(rows: T[]): string {
  if (rows.length === 0) return '';
  return Papa.unparse(rows);
}

export async function exportProducts(): Promise<void> {
  const { data, error } = await supabase
    .from('products')
    .select(
      'id, name, barcode, unit, selling_price_cents, current_cost_cents, stock_quantity, low_stock_threshold, active, created_at'
    )
    .order('name');

  if (error) throw new Error(error.message);

  const date = new Date().toISOString().slice(0, 10);
  await saveTextFile(`products-${date}.csv`, toCsvBlob(data ?? []));
}

export async function exportSales(): Promise<void> {
  const { data, error } = await supabase
    .from('sales')
    .select(
      'id, created_at, cashier_id, customer_id, payment_method, discount_cents, total_cents, voided_at'
    )
    .order('created_at', { ascending: false })
    .limit(50000);

  if (error) throw new Error(error.message);

  const date = new Date().toISOString().slice(0, 10);
  await saveTextFile(`sales-${date}.csv`, toCsvBlob(data ?? []));
}

export async function exportPurchases(): Promise<void> {
  const { data, error } = await supabase
    .from('purchases')
    .select('id, created_at, supplier_id, notes')
    .order('created_at', { ascending: false })
    .limit(50000);

  if (error) throw new Error(error.message);

  const date = new Date().toISOString().slice(0, 10);
  await saveTextFile(`purchases-${date}.csv`, toCsvBlob(data ?? []));
}

// Exports products, sales, and purchases in sequence. On web each triggers a
// download; on mobile each opens a share sheet (one after the other).
export async function exportEverything(): Promise<void> {
  await exportProducts();
  await exportSales();
  await exportPurchases();
  await markBackupDone();
}
