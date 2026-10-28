/**
 * Proves, against a REAL Supabase project, two facts the report screens
 * depend on that no unit test can check (they live in SQL, behind RPCs):
 *
 *   1. A product's "CA" (revenue) in report_product_performance is NET of
 *      its allocated share of the sale-level discount -- not the raw
 *      quantity x unit price.
 *   2. A voided sale contributes nothing to report_summary's revenue,
 *      profit or transaction count, nor to report_product_performance,
 *      for any product on it.
 *
 * Reading sale_line_economics and report_summary in the migration tells
 * you what should happen (both already filter `voided_at is null` and
 * both already use net_revenue_cents, not line_total_cents). Only running
 * them against a real database proves it still does, including after any
 * future `create or replace function` on these two RPCs.
 *
 * ---------------------------------------------------------------------------
 * SETUP (one time)
 *
 * Run against a local dev stack (`npx supabase start` + `npx supabase db
 * reset`, which seeds the owner account via supabase/seed.sql) or any other
 * Supabase project with that same owner/product fixture, then export:
 *
 *   SUPABASE_TEST_URL="http://127.0.0.1:54321"
 *   SUPABASE_TEST_ANON_KEY="<anon key from `npx supabase status`>"
 *   SUPABASE_TEST_OWNER_EMAIL="owner@corniche.local"
 *   SUPABASE_TEST_OWNER_PASSWORD="owner123"
 *
 *   npx jest tests/reports/discountAndVoid.live.test.ts
 *
 * Without those variables every test below is skipped, so `npm run check`
 * and CI stay green. A skipped run proves nothing -- run it for real once
 * before launch, and again after any change to report_summary,
 * report_product_performance, sale_line_economics, record_sale or
 * void_sale.
 * ---------------------------------------------------------------------------
 */
import { randomUUID } from "crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const ownerEmail = process.env.SUPABASE_TEST_OWNER_EMAIL;
const ownerPassword = process.env.SUPABASE_TEST_OWNER_PASSWORD;

const envConfigured = Boolean(url && anonKey && ownerEmail && ownerPassword);

type ReportSummaryRow = {
  revenue_cents: number;
  cogs_cents: number;
  gross_profit_cents: number;
  transaction_count: number;
};

type ProductPerformanceRow = {
  product_id: string;
  quantity: number;
  revenue_cents: number;
  profit_cents: number;
};

type ProductRow = {
  id: string;
  selling_price_cents: number;
  current_cost_cents: number;
};

// Jest's describe.skip keeps the file valid (and the reason visible) when
// the credentials are absent, same pattern as tests/security/cashierIsolation.test.ts.
const suite = envConfigured ? describe : describe.skip;

suite("product-table CA nets discounts; voided sales are excluded", () => {
  let client: SupabaseClient;

  beforeAll(async () => {
    client = createClient(url as string, anonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({
      email: ownerEmail as string,
      password: ownerPassword as string,
    });
    if (error) throw new Error(`Owner sign-in failed: ${error.message}`);
  });

  afterAll(async () => {
    if (client) await client.auth.signOut();
  });

  describe("live RPC assertions", () => {
    let kept: { quantity: number; discountCents: number } | null = null;
    let product: ProductRow;
    let from: string;
    let to: string;

    beforeAll(async () => {
      const { data: productData, error: productError } = await client
        .from("products_cashier_view")
        .select("id")
        .eq("barcode", "6111000000011")
        .single();
      if (productError) throw new Error(`Fixture product lookup failed: ${productError.message}`);

      const { data: ownerProduct, error: ownerProductError } = await client
        .from("products")
        .select("id, selling_price_cents, current_cost_cents")
        .eq("id", (productData as { id: string }).id)
        .single();
      if (ownerProductError) throw new Error(ownerProductError.message);
      product = ownerProduct as ProductRow;

      const testStart = new Date(Date.now() - 2000);
      from = testStart.toISOString();

      // Kept sale: 3 units, with a flat 1.50 DH sale-level discount. With a
      // single line the entire discount allocates to it (ratio 1), so the
      // expected net revenue is exact, not an approximation.
      const keptQuantity = 3;
      const discountCents = 150;
      kept = { quantity: keptQuantity, discountCents };

      const { error: keptError } = await client.rpc("record_sale", {
        p_sale_id: randomUUID(),
        p_customer_id: null,
        p_payment_method: "cash",
        p_discount_cents: discountCents,
        p_lines: [
          {
            product_id: product.id,
            quantity: keptQuantity,
            unit_price_cents: product.selling_price_cents,
            discount_cents: 0,
          },
        ],
        p_occurred_at: new Date().toISOString(),
      });
      if (keptError) throw new Error(`record_sale (kept) failed: ${keptError.message}`);

      // Voided sale: 2 more units, no discount, then immediately voided.
      // Its revenue/profit/quantity must vanish from both RPCs below.
      const voidedQuantity = 2;
      const voidedSaleId = randomUUID();

      const { error: voidedError } = await client.rpc("record_sale", {
        p_sale_id: voidedSaleId,
        p_customer_id: null,
        p_payment_method: "cash",
        p_discount_cents: 0,
        p_lines: [
          {
            product_id: product.id,
            quantity: voidedQuantity,
            unit_price_cents: product.selling_price_cents,
            discount_cents: 0,
          },
        ],
        p_occurred_at: new Date().toISOString(),
      });
      if (voidedError) throw new Error(`record_sale (to-void) failed: ${voidedError.message}`);

      const { error: voidError } = await client.rpc("void_sale", {
        p_sale_id: voidedSaleId,
        p_reason: "test: must not count toward reports",
      });
      if (voidError) throw new Error(`void_sale failed: ${voidError.message}`);

      to = new Date(Date.now() + 2000).toISOString();
    });

    it("report_product_performance's revenue_cents is net of the allocated discount, and excludes the voided sale's quantity", async () => {
      const { data, error } = await client.rpc("report_product_performance", {
        p_from: from,
        p_to: to,
      });
      if (error) throw new Error(error.message);

      const row = (data as ProductPerformanceRow[]).find((r) => r.product_id === product.id);
      expect(row).toBeTruthy();

      const expectedQuantity = kept!.quantity; // NOT kept + voided (3, not 5)
      const expectedRevenue = kept!.quantity * product.selling_price_cents - kept!.discountCents; // NOT the gross 2100
      const expectedProfit = expectedRevenue - kept!.quantity * product.current_cost_cents;

      expect(Number(row!.quantity)).toBe(expectedQuantity);
      expect(row!.revenue_cents).toBe(expectedRevenue);
      expect(row!.profit_cents).toBe(expectedProfit);
    });

    it("report_summary's revenue, profit and transaction_count exclude the voided sale entirely", async () => {
      const { data, error } = await client.rpc("report_summary", { p_from: from, p_to: to });
      if (error) throw new Error(error.message);

      const row = (data as ReportSummaryRow[])[0];
      const expectedRevenue = kept!.quantity * product.selling_price_cents - kept!.discountCents;
      const expectedCogs = kept!.quantity * product.current_cost_cents;

      // transaction_count counts sales, not sale_items -- exactly 1 (the
      // kept sale), never 2 (which would mean the voided one still counts).
      expect(row.transaction_count).toBe(1);
      expect(row.revenue_cents).toBe(expectedRevenue);
      expect(row.cogs_cents).toBe(expectedCogs);
      expect(row.gross_profit_cents).toBe(expectedRevenue - expectedCogs);
    });
  });
});
