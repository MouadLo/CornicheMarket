/**
 * What the PUBLIC anon key alone can reach: nothing. The anon key ships inside
 * every copy of the app, so anyone can extract it and talk to the REST API.
 * This needs no user credentials, only the project URL and that key:
 *
 *   export SUPABASE_TEST_URL="https://<project>.supabase.co"
 *   export SUPABASE_TEST_ANON_KEY="<anon key>"
 *   npx jest tests/security/anonAccess.test.ts
 *
 * Safe against production: reads are refused before any row is returned, and
 * function calls are refused before the function runs (permission denied).
 * If a function were still executable, the arguments are all no-ops (nil
 * ids, empty lists, 0 %), and the test fails loudly. Skipped without the
 * variables. Covers migration 026 (audit C06 / U01 and the anon follow-up).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const suite = url && anonKey ? describe : describe.skip;

const NIL = "00000000-0000-0000-0000-000000000000";
const RANGE = { p_from: "2026-01-01T00:00:00Z", p_to: "2027-01-01T00:00:00Z" };

// Every table and view in the public schema (migrations 1-26).
const READABLE = [
  "categories",
  "cost_history",
  "customer_balances",
  "customer_payments",
  "customers",
  "expiring_batches",
  "negative_stock_products",
  "product_sales_30d",
  "products",
  "products_cashier_view",
  "profiles",
  "purchase_items",
  "purchase_monthly_totals",
  "purchase_summaries",
  "purchase_supplier_totals",
  "purchases",
  "sale_items",
  "sale_items_cashier_view",
  "sale_line_economics",
  "sales",
  "stock_adjustments",
  "stock_adjustments_cashier_view",
  "store_settings",
  "suppliers",
];

// Every function the app or the owner calls, with harmless arguments.
const FUNCTIONS: [string, Record<string, unknown>][] = [
  [
    "record_sale",
    {
      p_sale_id: NIL,
      p_customer_id: null,
      p_payment_method: "cash",
      p_discount_cents: 0,
      p_lines: [],
      p_occurred_at: "2026-01-01T00:00:00Z",
    },
  ],
  [
    "record_customer_payment",
    { p_payment_id: NIL, p_customer_id: NIL, p_amount_cents: 1, p_method: "cash" },
  ],
  ["void_sale", { p_sale_id: NIL, p_reason: "probe" }],
  [
    "receive_delivery",
    {
      p_operation_id: NIL,
      p_supplier_id: null,
      p_notes: null,
      p_lines: [],
      p_price_updates: [],
      p_delivery_date: null,
    },
  ],
  ["void_purchase", { p_purchase_id: NIL, p_reason: "probe" }],
  ["preview_void_purchase", { p_purchase_id: NIL }],
  ["batch_update_selling_prices", { p_updates: [] }],
  ["bulk_adjust_selling_price", { p_category_id: NIL, p_percent: 0 }],
  ["report_summary", RANGE],
  ["report_daily_trend", RANGE],
  ["report_by_category", RANGE],
  ["report_by_hour", RANGE],
  ["report_product_performance", RANGE],
  ["report_dead_stock", { p_days: 30 }],
  ["report_inventory_value", {}],
  ["store_timezone", {}],
  ["is_owner", {}],
];

suite("the anon key alone reaches nothing (C06 / U01)", () => {
  let anon: SupabaseClient;
  beforeAll(() => {
    anon = createClient(url as string, anonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it.each(READABLE)("cannot read %s", async (table) => {
    const { data, error } = await anon.from(table).select("*").limit(1);
    expect(error?.message ?? `READABLE (${data?.length ?? 0} rows)`).toMatch(/permission denied/);
  });

  it.each(FUNCTIONS)("cannot execute %s", async (fn, args) => {
    const { error } = await anon.rpc(fn, args);
    expect(error?.message ?? "EXECUTED").toMatch(/permission denied for function/);
  });

  it.each<[string, Record<string, unknown>]>([
    ["sales", { id: NIL, cashier_id: NIL, payment_method: "cash", total_cents: 1 }],
    ["sale_items", { sale_id: NIL, product_id: NIL, quantity: 1, unit_price_cents: 1 }],
    ["customers", { name: "ZZ anon probe" }],
    ["customer_payments", { customer_id: NIL, amount_cents: 1, method: "cash", created_by: NIL }],
    [
      "stock_adjustments",
      { product_id: NIL, quantity_delta: 1, reason: "count_correction", created_by: NIL },
    ],
    ["products", { name: "ZZ anon probe", selling_price_cents: 1, unit: "piece" }],
  ])("cannot insert into %s", async (table, row) => {
    const { error } = await anon.from(table).insert(row);
    expect(error?.message ?? "INSERTED").toMatch(/permission denied/);
  });

  it.each(["sales", "customers", "products", "customer_payments"])(
    "cannot update or delete %s",
    async (table) => {
      const upd = await anon.from(table).update({ id: NIL }).eq("id", NIL);
      const del = await anon.from(table).delete().eq("id", NIL);
      expect(upd.error?.message ?? "UPDATED").toMatch(/permission denied/);
      expect(del.error?.message ?? "DELETED").toMatch(/permission denied/);
    }
  );
});
