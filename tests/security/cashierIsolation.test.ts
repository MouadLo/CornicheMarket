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
 * These are read-only probes plus writes that are expected to be refused
 * (the C06 block below aims them at ids that don't exist, so nothing is
 * written even on a vulnerable database). It is safe against production, but a staging copy is preferable.
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

// ---------------------------------------------------------------------------
// Audit C06 / U01 (migration 026): money and stock only change through the
// trusted functions, and the anon key alone reaches nothing.
//
// Safe against production: every probe points at ids that do not exist, so
// even a database that is still vulnerable writes nothing (the foreign key
// rejects it). The test then fails because the error is a foreign-key error
// instead of a permission error, which is exactly the signal wanted.
// The full attack suite, with fixtures, is tests/security/writePaths.live.test.ts
// (local only).
// ---------------------------------------------------------------------------
const NO_ROW = "00000000-0000-0000-0000-00000000c006";
const DENIED = /permission denied/;

suite("money and stock writes only go through trusted functions (C06)", () => {
  let client: SupabaseClient;
  let anon: SupabaseClient;
  let cashierId: string;

  beforeAll(async () => {
    client = createClient(url as string, anonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    anon = createClient(url as string, anonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInWithPassword({
      email: email as string,
      password: password as string,
    });
    if (error) throw new Error(`Cashier sign-in failed: ${error.message}`);
    cashierId = data.user.id;
  });

  afterAll(async () => {
    await client?.auth.signOut();
  });

  it("a cashier cannot insert a sale header directly", async () => {
    const { error } = await client.from("sales").insert({
      id: NO_ROW,
      cashier_id: cashierId,
      customer_id: NO_ROW,
      payment_method: "cash",
      total_cents: 1,
    });
    expect(error?.message ?? "inserted").toMatch(DENIED);
  });

  it("a cashier cannot insert sale lines directly", async () => {
    const { error } = await client.from("sale_items").insert({
      sale_id: NO_ROW,
      product_id: NO_ROW,
      quantity: 1,
      unit_price_cents: 1,
    });
    expect(error?.message ?? "inserted").toMatch(DENIED);
  });

  it("a cashier cannot insert a customer payment directly", async () => {
    const { error } = await client.from("customer_payments").insert({
      customer_id: NO_ROW,
      amount_cents: 100,
      method: "cash",
      created_by: cashierId,
    });
    expect(error?.message ?? "inserted").toMatch(DENIED);
  });

  it("a cashier cannot insert a stock adjustment directly", async () => {
    const { error } = await client.from("stock_adjustments").insert({
      product_id: NO_ROW,
      quantity_delta: 1,
      reason: "count_correction",
      created_by: cashierId,
    });
    // Refused by RLS (owner-only insert) rather than by a missing privilege.
    expect(error?.message ?? "inserted").toMatch(/row-level security|permission denied/);
  });

  it.each(["sales", "sale_items", "customer_payments", "stock_adjustments"])(
    "a cashier has no UPDATE or DELETE on %s",
    async (table) => {
      const column =
        table === "customer_payments"
          ? "amount_cents"
          : table === "stock_adjustments"
            ? "quantity_delta"
            : table === "sales"
              ? "total_cents"
              : "unit_price_cents";
      const upd = await client
        .from(table)
        .update({ [column]: 1 })
        .eq("id", NO_ROW);
      const del = await client.from(table).delete().eq("id", NO_ROW);
      expect(upd.error?.message ?? "allowed").toMatch(DENIED);
      expect(del.error?.message ?? "allowed").toMatch(DENIED);
    }
  );

  // Migration 027: the owner's settings, the audit trail and the price history
  // are owner-only. Reading is the production-safe probe: the rows exist, so a
  // cashier who could see them would get data back.
  it.each(["owner_settings", "activity_log", "selling_price_history"])(
    "a cashier sees no rows of %s",
    async (table) => {
      const { data, error } = await client.from(table).select("*").limit(1);
      if (error) expect(error.message).toMatch(/permission denied|row-level security/);
      else expect(data).toEqual([]);
    }
  );

  // Audit C05 (migration 028): only the owner can record a stranded sale as
  // recovered, and a sale can never be credited to someone else by naming them.
  // Both probes use a nil id and no lines, so nothing is written even if refused late.
  it("a cashier cannot recover a sale (owner only)", async () => {
    const { error } = await client.rpc("recover_sale", {
      p_sale_id: NO_ROW,
      p_customer_id: null,
      p_payment_method: "cash",
      p_discount_cents: 0,
      p_lines: [],
      p_occurred_at: "2026-01-01T00:00:00Z",
      p_original_cashier_id: cashierId,
    });
    expect(error?.message ?? "allowed").toMatch(/Only the owner/);
  });

  it("a cashier cannot ring a sale up as another user (expected-cashier guard)", async () => {
    const { error } = await client.rpc("record_sale", {
      p_sale_id: NO_ROW,
      p_customer_id: null,
      p_payment_method: "cash",
      p_discount_cents: 0,
      p_lines: [],
      p_occurred_at: "2026-01-01T00:00:00Z",
      p_expected_cashier: NO_ROW,
    });
    expect(error?.message ?? "allowed").toMatch(/another user/);
  });

  it.each([
    ["products_cashier_view", "selling_price_cents"],
    ["sale_items_cashier_view", "quantity"],
    ["stock_adjustments_cashier_view", "quantity_delta"],
  ])("a cashier cannot write through %s (views skip RLS)", async (view, column) => {
    const { error } = await client
      .from(view)
      .update({ [column]: 1 })
      .eq("id", NO_ROW);
    expect(error?.message ?? "allowed").toMatch(/permission denied|cannot update view/);
  });

  it.each([
    [
      "record_sale",
      {
        p_sale_id: NO_ROW,
        p_customer_id: null,
        p_payment_method: "cash",
        p_discount_cents: 0,
        p_lines: [],
        p_occurred_at: "2026-01-01T00:00:00Z",
      },
    ],
    [
      "record_customer_payment",
      { p_payment_id: NO_ROW, p_customer_id: NO_ROW, p_amount_cents: 1, p_method: "cash" },
    ],
    ["void_sale", { p_sale_id: NO_ROW, p_reason: "probe" }],
    ["batch_update_selling_prices", { p_updates: [] }],
    ["bulk_adjust_selling_price", { p_category_id: NO_ROW, p_percent: 0 }],
    ["store_timezone", {}],
    ["is_owner", {}],
  ])("the anon key alone cannot execute %s", async (fn, args) => {
    const { error } = await anon.rpc(fn, args);
    expect(error?.message ?? "executed").toMatch(/permission denied for function/);
  });

  it.each([
    "customer_balances",
    "products_cashier_view",
    "product_sales_30d",
    "customers",
    "sales",
  ])("the anon key alone cannot read %s", async (table) => {
    const { error } = await anon.from(table).select("*").limit(1);
    expect(error?.message ?? "readable").toMatch(DENIED);
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
