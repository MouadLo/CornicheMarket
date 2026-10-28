/**
 * Proves the store-timezone fix against a REAL Supabase project, at the
 * level the unit tests in tests/reports/timezone.test.ts cannot reach:
 * the actual SQL RPCs (report_daily_trend, report_by_hour), not just the
 * TypeScript date-math they're supposed to mirror.
 *
 *   1. A sale at 23:30 and another at 00:30 Africa/Casablanca land on
 *      different calendar days and different hour buckets -- during an
 *      ordinary month (UTC+1).
 *   2. The same boundary, during Morocco's real Ramadan-observance window
 *      (Africa/Casablanca reverts to UTC+0 in tzdata) -- still correct,
 *      with no special-casing in application code: the SQL's
 *      `at time zone 'Africa/Casablanca'` already reflects whatever the
 *      system's tzdata says for that date.
 *   3. store_settings (which holds the configured zone) can be updated by
 *      the owner and not by a cashier.
 *
 * ---------------------------------------------------------------------------
 * SETUP (one time)
 *
 * Run against a local dev stack (`npx supabase start` + `npx supabase db
 * reset`, which seeds both accounts via supabase/seed.sql) or any other
 * Supabase project with that same owner/cashier/product fixture, then
 * export:
 *
 *   SUPABASE_TEST_URL="http://127.0.0.1:54321"
 *   SUPABASE_TEST_ANON_KEY="<anon key from `npx supabase status`>"
 *   SUPABASE_TEST_OWNER_EMAIL="owner@corniche.local"
 *   SUPABASE_TEST_OWNER_PASSWORD="owner123"
 *   SUPABASE_TEST_CASHIER_EMAIL="cashier@corniche.local"
 *   SUPABASE_TEST_CASHIER_PASSWORD="cashier123"
 *
 *   npx jest tests/reports/timezoneLive.live.test.ts
 *
 * Without those variables every test below is skipped, so `npm run check`
 * and CI stay green. A skipped run proves nothing -- run it for real
 * before launch, and again after any change to report_daily_trend,
 * report_by_hour, store_settings or record_sale.
 * ---------------------------------------------------------------------------
 */
import { randomUUID } from "crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const ownerEmail = process.env.SUPABASE_TEST_OWNER_EMAIL;
const ownerPassword = process.env.SUPABASE_TEST_OWNER_PASSWORD;
const cashierEmail = process.env.SUPABASE_TEST_CASHIER_EMAIL;
const cashierPassword = process.env.SUPABASE_TEST_CASHIER_PASSWORD;

const envConfigured = Boolean(
  url && anonKey && ownerEmail && ownerPassword && cashierEmail && cashierPassword
);

type DailyTrendRow = { day: string; transaction_count: number };
type HourRow = { hour: number; transaction_count: number };
type ProductRow = { id: string; selling_price_cents: number; current_cost_cents: number };

async function recordSale(
  client: SupabaseClient,
  productId: string,
  priceCents: number,
  occurredAt: string
) {
  const { error } = await client.rpc("record_sale", {
    p_sale_id: randomUUID(),
    p_customer_id: null,
    p_payment_method: "cash",
    p_discount_cents: 0,
    p_lines: [
      { product_id: productId, quantity: 1, unit_price_cents: priceCents, discount_cents: 0 },
    ],
    p_occurred_at: occurredAt,
  });
  if (error) throw new Error(`record_sale failed: ${error.message}`);
}

const suite = envConfigured ? describe : describe.skip;

suite("store timezone: 23:30/00:30 boundary and owner-only settings", () => {
  let ownerClient: SupabaseClient;
  let product: ProductRow;

  beforeAll(async () => {
    ownerClient = createClient(url as string, anonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await ownerClient.auth.signInWithPassword({
      email: ownerEmail as string,
      password: ownerPassword as string,
    });
    if (error) throw new Error(`Owner sign-in failed: ${error.message}`);

    const { data, error: productError } = await ownerClient
      .from("products")
      .select("id, selling_price_cents, current_cost_cents")
      .gt("current_cost_cents", 0)
      .gt("stock_quantity", 10)
      .limit(1)
      .single();
    if (productError) throw new Error(`Fixture product lookup failed: ${productError.message}`);
    product = data as ProductRow;
  });

  afterAll(async () => {
    if (ownerClient) await ownerClient.auth.signOut();
  });

  it("a 23:30 sale and a 00:30 sale land on different days and hours in an ordinary month (UTC+1)", async () => {
    // 2026-01-15 23:30 Africa/Casablanca (UTC+1) = 2026-01-15T22:30:00Z.
    // 2026-01-16 00:30 Africa/Casablanca (UTC+1) = 2026-01-15T23:30:00Z.
    await recordSale(ownerClient, product.id, product.selling_price_cents, "2026-01-15T22:30:00Z");
    await recordSale(ownerClient, product.id, product.selling_price_cents, "2026-01-15T23:30:00Z");

    const { data: trend, error: trendError } = await ownerClient.rpc("report_daily_trend", {
      p_from: "2026-01-14T00:00:00Z",
      p_to: "2026-01-18T00:00:00Z",
    });
    if (trendError) throw new Error(trendError.message);
    const days = (trend as DailyTrendRow[]).map((r) => r.day).sort();
    expect(days).toEqual(["2026-01-15", "2026-01-16"]);

    const { data: hours, error: hourError } = await ownerClient.rpc("report_by_hour", {
      p_from: "2026-01-15T00:00:00Z",
      p_to: "2026-01-17T00:00:00Z",
    });
    if (hourError) throw new Error(hourError.message);
    const hourSet = (hours as HourRow[]).map((r) => r.hour).sort((a, b) => a - b);
    expect(hourSet).toEqual([0, 23]);
  });

  it("the same boundary is still correct during Morocco's Ramadan UTC+0 window, with no app-side special-casing", async () => {
    // Africa/Casablanca reverts to UTC+0 for Ramadan; verified live against
    // this stack's own tzdata (`select ... at time zone 'Africa/Casablanca'`)
    // to land in that window, not assumed from a fixed calendar date.
    // 2026-03-01 23:30 local (UTC+0) = 2026-03-01T23:30:00Z.
    // 2026-03-02 00:30 local (UTC+0) = 2026-03-02T00:30:00Z.
    await recordSale(ownerClient, product.id, product.selling_price_cents, "2026-03-01T23:30:00Z");
    await recordSale(ownerClient, product.id, product.selling_price_cents, "2026-03-02T00:30:00Z");

    const { data: trend, error: trendError } = await ownerClient.rpc("report_daily_trend", {
      p_from: "2026-02-28T00:00:00Z",
      p_to: "2026-03-04T00:00:00Z",
    });
    if (trendError) throw new Error(trendError.message);
    const days = (trend as DailyTrendRow[]).map((r) => r.day).sort();
    expect(days).toEqual(["2026-03-01", "2026-03-02"]);

    const { data: hours, error: hourError } = await ownerClient.rpc("report_by_hour", {
      p_from: "2026-03-01T00:00:00Z",
      p_to: "2026-03-03T00:00:00Z",
    });
    if (hourError) throw new Error(hourError.message);
    const hourSet = (hours as HourRow[]).map((r) => r.hour).sort((a, b) => a - b);
    expect(hourSet).toEqual([0, 23]);
  });

  it("store_settings can be updated by the owner, and not by a cashier", async () => {
    const cashierClient = createClient(url as string, anonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: cashierSignInError } = await cashierClient.auth.signInWithPassword({
      email: cashierEmail as string,
      password: cashierPassword as string,
    });
    if (cashierSignInError)
      throw new Error(`Cashier sign-in failed: ${cashierSignInError.message}`);

    const { data: before } = await ownerClient
      .from("store_settings")
      .select("timezone")
      .eq("singleton", true)
      .single();
    const originalTimezone = (before as { timezone: string }).timezone;

    // Cashier's update must silently affect zero rows (RLS), never error
    // loudly -- PostgREST's usual behavior for a write a policy refuses.
    const { data: cashierUpdate, error: cashierUpdateError } = await cashierClient
      .from("store_settings")
      .update({ timezone: "Europe/Paris" })
      .eq("singleton", true)
      .select();
    expect(cashierUpdateError).toBeNull();
    expect(cashierUpdate ?? []).toHaveLength(0);

    const { data: afterCashierAttempt } = await ownerClient
      .from("store_settings")
      .select("timezone")
      .eq("singleton", true)
      .single();
    expect((afterCashierAttempt as { timezone: string }).timezone).toBe(originalTimezone);

    // Owner's identical update must succeed.
    const { data: ownerUpdate, error: ownerUpdateError } = await ownerClient
      .from("store_settings")
      .update({ timezone: "Europe/Paris" })
      .eq("singleton", true)
      .select();
    expect(ownerUpdateError).toBeNull();
    expect(ownerUpdate ?? []).toHaveLength(1);

    // Restore, so a repeated run of this suite starts from the same state.
    await ownerClient
      .from("store_settings")
      .update({ timezone: originalTimezone })
      .eq("singleton", true);

    await cashierClient.auth.signOut();
  });
});
