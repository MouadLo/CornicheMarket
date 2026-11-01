/**
 * Proves, against a REAL Supabase project, that a cashier cannot read cost,
 * weighted-average cost or profit through the REST API — and cannot change
 * prices, void sales or escalate their own role.
 *
 * Reading the RLS policies tells you what should happen. Only running them
 * tells you what does. This is the only test in the suite that talks to a
 * live database.
 *
 * ---------------------------------------------------------------------------
 * SETUP (one time)
 *
 * 1. Create a cashier user in your Supabase project:
 *      - Dashboard -> Authentication -> Users -> Add user
 *      - Then set their role:
 *          update profiles set role = 'cashier' where id = '<that user id>';
 *
 * 2. Export four variables, then run this file:
 *
 *      export SUPABASE_TEST_URL="https://<project>.supabase.co"
 *      export SUPABASE_TEST_ANON_KEY="<anon key>"
 *      export SUPABASE_TEST_CASHIER_EMAIL="cashier@example.com"
 *      export SUPABASE_TEST_CASHIER_PASSWORD="<password>"
 *
 *      npx jest tests/security/cashierIsolation.test.ts
 *
 * Without those variables every test below is skipped, so `npm run check`
 * and CI stay green. A skipped run proves nothing — run it for real once
 * before launch, and again after any migration that touches a policy,
 * a view, or a column holding cost.
 *
 * These are read-only probes plus two writes that are expected to be
 * refused. It is safe against production, but a staging copy is preferable.
 * ---------------------------------------------------------------------------
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const email = process.env.SUPABASE_TEST_CASHIER_EMAIL;
const password = process.env.SUPABASE_TEST_CASHIER_PASSWORD;

const configured = Boolean(url && anonKey && email && password);

// Every cost-bearing column in the schema. If a migration adds another one,
// add it here too.
const COST_COLUMNS = [
  "current_cost_cents",
  "unit_cost_cents",
  "cost_cents",
  "profit_cents",
  "gross_profit_cents",
  "cogs_cents",
  "margin_percent",
];

function assertNoCostColumns(rows: Record<string, unknown>[] | null) {
  for (const row of rows ?? []) {
    for (const column of COST_COLUMNS) {
      expect(row).not.toHaveProperty(column);
    }
  }
}

// Jest's describe.skip keeps the file valid (and the reason visible) when the
// credentials are absent.
const suite = configured ? describe : describe.skip;

suite("a cashier token cannot reach cost, WAC or profit", () => {
  let client: SupabaseClient;
  let cashierId: string;

  beforeAll(async () => {
    client = createClient(url as string, anonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await client.auth.signInWithPassword({
      email: email as string,
      password: password as string,
    });

    if (error) throw new Error(`Cashier sign-in failed: ${error.message}`);
    cashierId = data.user?.id as string;

    // Guard against the fixture silently being an owner, which would make
    // every assertion below pass for the wrong reason.
    const { data: profile } = await client
      .from("profiles")
      .select("role")
      .eq("id", cashierId)
      .single();

    expect(profile).toBeTruthy();
    expect((profile as { role: string }).role).toBe("cashier");
  });

  afterAll(async () => {
    if (client) await client.auth.signOut();
  });

  // ── Base tables holding cost ─────────────────────────────────────────────
  // RLS has no cashier SELECT policy on any of these, so PostgREST returns
  // either a permission error or an empty set. Both are a pass; a row with a
  // cost column in it is a failure.

  it("cannot read products.current_cost_cents", async () => {
    const { data, error } = await client.from("products").select("id, current_cost_cents");
    if (!error) {
      expect(data ?? []).toHaveLength(0);
    }
  });

  it("cannot read the products base table at all", async () => {
    const { data, error } = await client.from("products").select("*").limit(5);
    if (!error) {
      expect(data ?? []).toHaveLength(0);
      assertNoCostColumns(data as Record<string, unknown>[]);
    }
  });

  it("cannot read sale_items.unit_cost_cents", async () => {
    const { data, error } = await client.from("sale_items").select("id, unit_cost_cents");
    if (!error) {
      expect(data ?? []).toHaveLength(0);
    }
  });

  it("cannot read purchase_items.unit_cost_cents", async () => {
    const { data, error } = await client.from("purchase_items").select("id, unit_cost_cents");
    if (!error) {
      expect(data ?? []).toHaveLength(0);
    }
  });

  it("cannot read cost_history", async () => {
    const { data, error } = await client.from("cost_history").select("*").limit(5);
    if (!error) {
      expect(data ?? []).toHaveLength(0);
    }
  });

  it("cannot read stock_adjustments.unit_cost_cents", async () => {
    const { data, error } = await client.from("stock_adjustments").select("id, unit_cost_cents");
    if (!error) {
      expect(data ?? []).toHaveLength(0);
    }
  });

  // ── Views that guard themselves with is_owner() ──────────────────────────

  it.each([
    "sale_line_economics",
    "purchase_summaries",
    "purchase_monthly_totals",
    "purchase_supplier_totals",
  ])("gets zero rows from %s", async (view) => {
    const { data, error } = await client.from(view).select("*").limit(5);
    if (!error) {
      expect(data ?? []).toHaveLength(0);
    }
  });

  // ── Report RPCs: every one must refuse ───────────────────────────────────

  it("is refused by every report function", async () => {
    const from = "2020-01-01T00:00:00Z";
    const to = "2030-01-01T00:00:00Z";

    const calls: [string, Record<string, unknown>][] = [
      ["report_summary", { p_from: from, p_to: to }],
      ["report_daily_trend", { p_from: from, p_to: to }],
      ["report_by_category", { p_from: from, p_to: to }],
      ["report_by_hour", { p_from: from, p_to: to }],
      ["report_product_performance", { p_from: from, p_to: to }],
      ["report_dead_stock", { p_days: 30 }],
      ["report_inventory_value", {}],
    ];

    for (const [fn, args] of calls) {
      const { data, error } = await client.rpc(fn, args);
      // The function raises 'Reports are owner only'. Treat an empty result
      // as acceptable too, but never a row carrying profit.
      if (!error) {
        expect(data ?? []).toHaveLength(0);
      } else {
        expect(error.message.toLowerCase()).toContain("owner");
      }
    }
  });

  // ── The cashier's own read path must work, and carry no cost ─────────────

  it("can read products_cashier_view, and it exposes no cost column", async () => {
    const { data, error } = await client.from("products_cashier_view").select("*").limit(10);

    expect(error).toBeNull();
    assertNoCostColumns(data as Record<string, unknown>[]);
  });

  it("can read sale_items_cashier_view, and it exposes no cost column", async () => {
    const { data, error } = await client.from("sale_items_cashier_view").select("*").limit(10);

    expect(error).toBeNull();
    assertNoCostColumns(data as Record<string, unknown>[]);
  });

  // ── Writes a cashier must not be able to make ────────────────────────────

  it("cannot change a selling price", async () => {
    // Needs a product id, which a cashier can only get from the view.
    const { data: products } = await client
      .from("products_cashier_view")
      .select("id, selling_price_cents")
      .limit(1);

    const product = (products ?? [])[0] as { id: string; selling_price_cents: number } | undefined;
    if (!product) return; // empty catalogue: nothing to attempt

    const tampered = product.selling_price_cents + 10_000;

    await client.from("products").update({ selling_price_cents: tampered }).eq("id", product.id);

    // The update matches zero rows under RLS, so the price must be unchanged.
    const { data: after } = await client
      .from("products_cashier_view")
      .select("selling_price_cents")
      .eq("id", product.id)
      .single();

    expect((after as { selling_price_cents: number }).selling_price_cents).toBe(
      product.selling_price_cents
    );
  });

  it("cannot move prices in bulk", async () => {
    const { data, error } = await client.rpc("bulk_adjust_selling_price", {
      p_category_id: null,
      p_percent: 50,
    });

    // security invoker + owner-only UPDATE policy => zero rows affected.
    if (!error) {
      expect(data ?? 0).toBe(0);
    }
  });

  it("cannot void a sale", async () => {
    const { error } = await client.rpc("void_sale", {
      p_sale_id: "00000000-0000-0000-0000-000000000000",
      p_reason: "rls probe",
    });

    expect(error).toBeTruthy();
    expect((error as { message: string }).message.toLowerCase()).toContain("owner");
  });

  it("cannot void a delivery, nor preview what voiding one would do to cost", async () => {
    const none = "00000000-0000-0000-0000-000000000000";

    const voided = await client.rpc("void_purchase", {
      p_purchase_id: none,
      p_reason: "rls probe",
    });
    const preview = await client.rpc("preview_void_purchase", { p_purchase_id: none });

    for (const { error } of [voided, preview]) {
      expect(error).toBeTruthy();
      expect((error as { message: string }).message.toLowerCase()).toContain("owner");
    }
  });

  it("cannot delete a product", async () => {
    const { data: products } = await client.from("products_cashier_view").select("id").limit(1);

    const product = (products ?? [])[0] as { id: string } | undefined;
    if (!product) return;

    await client.from("products").delete().eq("id", product.id);

    // Still there.
    const { data: after } = await client
      .from("products_cashier_view")
      .select("id")
      .eq("id", product.id);

    expect(after ?? []).toHaveLength(1);
  });

  it("cannot promote itself to owner", async () => {
    const { error } = await client.from("profiles").update({ role: "owner" }).eq("id", cashierId);

    // trg_prevent_role_self_escalation raises for any non-owner API caller.
    expect(error).toBeTruthy();

    const { data: after } = await client
      .from("profiles")
      .select("role")
      .eq("id", cashierId)
      .single();

    expect((after as { role: string }).role).toBe("cashier");
  });
});

// Always-visible reminder when the suite is skipped, so an unconfigured run
// cannot be mistaken for a passing one.
if (!configured) {
  describe("cashier isolation", () => {
    it("SKIPPED — set SUPABASE_TEST_* env vars to prove cashier isolation", () => {
      expect(configured).toBe(false);
    });
  });
}
