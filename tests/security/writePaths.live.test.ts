/**
 * Audit C06 / U01: money and stock may only change through the trusted
 * database functions (record_sale, void_sale, record_customer_payment,
 * receive_delivery, void_purchase, and the stock-adjustment path). This
 * suite attacks every direct write path as the seeded cashier, the owner and
 * an anonymous caller, against a REAL local database, and checks both that the
 * attempt is refused and that nothing changed.
 *
 * It was written failing-first: run against `main` before migration 026 to
 * see which attacks succeeded (listed in the PR description).
 *
 * ---------------------------------------------------------------------------
 * SETUP: a local dev stack (`npx supabase start` + `npx supabase db reset`,
 * which seeds owner@corniche.local and cashier@corniche.local), then:
 *
 *   SUPABASE_TEST_URL="http://127.0.0.1:54321"
 *   SUPABASE_TEST_ANON_KEY="<anon key from `npx supabase status`>"
 *   SUPABASE_TEST_OWNER_EMAIL="owner@corniche.local"
 *   SUPABASE_TEST_OWNER_PASSWORD="owner123"
 *   SUPABASE_TEST_CASHIER_EMAIL="cashier@corniche.local"
 *   SUPABASE_TEST_CASHIER_PASSWORD="cashier123"
 *
 *   npx jest tests/security/writePaths.live.test.ts
 *
 * Writes products named "ZZ-LIVE C06 ...", sales, customers and payments.
 * LOCAL ONLY: never point it at production (an attack that unexpectedly
 * succeeds would write junk). The production-safe subset of these denials
 * lives in tests/security/cashierIsolation.test.ts.
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

const configured = Boolean(
  url && anonKey && ownerEmail && ownerPassword && cashierEmail && cashierPassword
);
const suite = configured ? describe : describe.skip;

function client(): SupabaseClient {
  return createClient(url as string, anonKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return c;
}

type Result = { error: { message: string } | null; data?: unknown };

// An attack is refused when PostgREST returns an error, or when RLS silently
// filtered it to zero rows. Callers also verify the database state.
function rowsTouched(res: Result): number {
  return Array.isArray(res.data) ? res.data.length : res.data ? 1 : 0;
}

suite("C06 write paths (live)", () => {
  let owner: SupabaseClient;
  let cashier: SupabaseClient;
  let anon: SupabaseClient;
  let ownerId: string;
  let cashierId: string;
  let productId: string;
  let ownSaleId: string;
  let voidedSaleId: string;
  let customerId: string;

  async function recordSale(c: SupabaseClient, overrides: Record<string, unknown> = {}) {
    const id = randomUUID();
    const { error } = await c.rpc("record_sale", {
      p_sale_id: id,
      p_customer_id: null,
      p_payment_method: "cash",
      p_discount_cents: 0,
      p_lines: [{ product_id: productId, quantity: 1, unit_price_cents: 1000, discount_cents: 0 }],
      p_occurred_at: new Date().toISOString(),
      ...overrides,
    });
    if (error) throw new Error(`record_sale failed: ${error.message}`);
    return id;
  }

  async function sale(id: string) {
    const { data } = await owner
      .from("sales")
      .select("id, total_cents, discount_cents, voided_at")
      .eq("id", id)
      .maybeSingle();
    return data as { total_cents: number; voided_at: string | null } | null;
  }
  async function lineCount(saleId: string) {
    const { data } = await owner.from("sale_items").select("id").eq("sale_id", saleId);
    return (data ?? []).length;
  }
  async function stock() {
    const { data } = await owner
      .from("products")
      .select("stock_quantity, current_cost_cents")
      .eq("id", productId)
      .single();
    const row = data as { stock_quantity: number; current_cost_cents: number };
    return { stock: Number(row.stock_quantity), cost: Number(row.current_cost_cents) };
  }

  beforeAll(async () => {
    owner = await signIn(ownerEmail as string, ownerPassword as string);
    cashier = await signIn(cashierEmail as string, cashierPassword as string);
    anon = client();
    ownerId = (await owner.auth.getUser()).data.user?.id as string;
    cashierId = (await cashier.auth.getUser()).data.user?.id as string;

    const product = await owner
      .from("products")
      .insert({
        name: `ZZ-LIVE C06 ${randomUUID().slice(0, 8)}`,
        selling_price_cents: 1000,
        unit: "piece",
      })
      .select("id")
      .single();
    if (product.error) throw new Error(product.error.message);
    productId = (product.data as { id: string }).id;

    ownSaleId = await recordSale(cashier);
    voidedSaleId = await recordSale(cashier);
    const voided = await owner.rpc("void_sale", {
      p_sale_id: voidedSaleId,
      p_reason: "C06 fixture",
    });
    if (voided.error) throw new Error(voided.error.message);

    const customer = await cashier
      .from("customers")
      .insert({ name: `ZZ-LIVE C06 client ${randomUUID().slice(0, 6)}` })
      .select("id")
      .single();
    if (customer.error) throw new Error(customer.error.message);
    customerId = (customer.data as { id: string }).id;
  });

  afterAll(async () => {
    await owner?.auth.signOut();
    await cashier?.auth.signOut();
  });

  // -------------------------------------------------------------------------
  describe("the legitimate paths still work", () => {
    it("cashier records a sale through record_sale, with the total computed server-side", async () => {
      const id = await recordSale(cashier, {
        p_lines: [
          { product_id: productId, quantity: 2, unit_price_cents: 1000, discount_cents: 100 },
        ],
        p_discount_cents: 50,
      });
      expect((await sale(id))?.total_cents).toBe(1850);
      expect(await lineCount(id)).toBe(1);
    });

    it("record_sale stays idempotent: the same id twice records one sale", async () => {
      const id = randomUUID();
      const args = {
        p_sale_id: id,
        p_customer_id: null,
        p_payment_method: "cash",
        p_discount_cents: 0,
        p_lines: [
          { product_id: productId, quantity: 1, unit_price_cents: 1000, discount_cents: 0 },
        ],
        p_occurred_at: new Date().toISOString(),
      };
      expect((await cashier.rpc("record_sale", args)).error).toBeNull();
      expect((await cashier.rpc("record_sale", args)).error).toBeNull();
      expect(await lineCount(id)).toBe(1);
    });

    it("cashier records a credit payment through record_customer_payment (idempotent by id)", async () => {
      const id = randomUUID();
      const args = {
        p_payment_id: id,
        p_customer_id: customerId,
        p_amount_cents: 500,
        p_method: "cash",
      };
      expect((await cashier.rpc("record_customer_payment", args)).error).toBeNull();
      expect((await cashier.rpc("record_customer_payment", args)).error).toBeNull();
      const { data } = await owner.from("customer_payments").select("id, created_by").eq("id", id);
      expect(data).toHaveLength(1);
      expect((data as { created_by: string }[])[0].created_by).toBe(cashierId);
    });

    it("record_customer_payment refuses a reused id with a different amount", async () => {
      const id = randomUUID();
      await cashier.rpc("record_customer_payment", {
        p_payment_id: id,
        p_customer_id: customerId,
        p_amount_cents: 500,
        p_method: "cash",
      });
      const again = await cashier.rpc("record_customer_payment", {
        p_payment_id: id,
        p_customer_id: customerId,
        p_amount_cents: 1,
        p_method: "cash",
      });
      expect(again.error).not.toBeNull();
    });

    it("cashier can still add a customer (no money involved)", async () => {
      const res = await cashier
        .from("customers")
        .insert({ name: `ZZ-LIVE C06 ${randomUUID().slice(0, 4)}` });
      expect(res.error).toBeNull();
    });

    it("owner voids a sale through void_sale", async () => {
      const id = await recordSale(cashier);
      expect(
        (await owner.rpc("void_sale", { p_sale_id: id, p_reason: "C06 legit void" })).error
      ).toBeNull();
      expect((await sale(id))?.voided_at).not.toBeNull();
    });

    it("owner records a stock adjustment and edits a product's price and name", async () => {
      const before = await stock();
      const adj = await owner.from("stock_adjustments").insert({
        product_id: productId,
        quantity_delta: -1,
        reason: "damaged",
        created_by: ownerId,
      });
      expect(adj.error).toBeNull();
      expect((await stock()).stock).toBe(before.stock - 1);
      const edit = await owner
        .from("products")
        .update({
          selling_price_cents: 1100,
          name: `ZZ-LIVE C06 edited ${randomUUID().slice(0, 4)}`,
        })
        .eq("id", productId);
      expect(edit.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("cashier direct writes are refused", () => {
    it("cannot insert a sale header with an arbitrary total", async () => {
      const id = randomUUID();
      const res = await cashier.from("sales").insert({
        id,
        cashier_id: cashierId,
        payment_method: "cash",
        discount_cents: 0,
        total_cents: 1,
      });
      expect(res.error).not.toBeNull();
      expect(await sale(id)).toBeNull();
    });

    it("cannot insert sale_items directly into its own sale", async () => {
      const before = await lineCount(ownSaleId);
      const res = await cashier.from("sale_items").insert({
        sale_id: ownSaleId,
        product_id: productId,
        quantity: 1,
        unit_price_cents: 1,
        discount_cents: 0,
      });
      expect(res.error).not.toBeNull();
      expect(await lineCount(ownSaleId)).toBe(before);
    });

    it("cannot append a line to a voided sale", async () => {
      const before = await lineCount(voidedSaleId);
      const stockBefore = await stock();
      const res = await cashier.from("sale_items").insert({
        sale_id: voidedSaleId,
        product_id: productId,
        quantity: 5,
        unit_price_cents: 0,
        discount_cents: 0,
      });
      expect(res.error).not.toBeNull();
      expect(await lineCount(voidedSaleId)).toBe(before);
      expect((await stock()).stock).toBe(stockBefore.stock);
    });

    it("cannot insert a customer payment directly", async () => {
      const id = randomUUID();
      const res = await cashier.from("customer_payments").insert({
        id,
        customer_id: customerId,
        amount_cents: 100000,
        method: "cash",
        created_by: cashierId,
      });
      expect(res.error).not.toBeNull();
      const { data } = await owner.from("customer_payments").select("id").eq("id", id);
      expect(data).toHaveLength(0);
    });

    it("cannot insert a stock adjustment directly", async () => {
      const before = await stock();
      const res = await cashier.from("stock_adjustments").insert({
        product_id: productId,
        quantity_delta: 50,
        reason: "count_correction",
        created_by: cashierId,
      });
      expect(res.error).not.toBeNull();
      expect((await stock()).stock).toBe(before.stock);
    });

    it("cannot update or delete its own sale", async () => {
      const before = await sale(ownSaleId);
      const upd = await cashier
        .from("sales")
        .update({ total_cents: 1 })
        .eq("id", ownSaleId)
        .select("id");
      const del = await cashier.from("sales").delete().eq("id", ownSaleId).select("id");
      expect(rowsTouched(upd)).toBe(0);
      expect(rowsTouched(del)).toBe(0);
      expect(await sale(ownSaleId)).toEqual(before);
    });

    it("cannot update or delete sale lines", async () => {
      const before = await lineCount(ownSaleId);
      const upd = await cashier
        .from("sale_items")
        .update({ unit_price_cents: 1 })
        .eq("sale_id", ownSaleId)
        .select("id");
      const del = await cashier.from("sale_items").delete().eq("sale_id", ownSaleId).select("id");
      expect(rowsTouched(upd)).toBe(0);
      expect(rowsTouched(del)).toBe(0);
      expect(await lineCount(ownSaleId)).toBe(before);
    });

    it("cannot update or delete customer payments or stock adjustments", async () => {
      const pay = await cashier
        .from("customer_payments")
        .update({ amount_cents: 1 })
        .neq("amount_cents", 1)
        .select("id");
      const payDel = await cashier
        .from("customer_payments")
        .delete()
        .neq("amount_cents", -1)
        .select("id");
      const adj = await cashier
        .from("stock_adjustments")
        .update({ quantity_delta: 999 })
        .neq("quantity_delta", 999)
        .select("id");
      const adjDel = await cashier
        .from("stock_adjustments")
        .delete()
        .neq("quantity_delta", 0)
        .select("id");
      expect([pay, payDel, adj, adjDel].map(rowsTouched)).toEqual([0, 0, 0, 0]);
    });

    it("cannot change a price or the stock by writing through products_cashier_view", async () => {
      const before = await stock();
      const { data: prices } = await owner
        .from("products")
        .select("selling_price_cents")
        .eq("id", productId)
        .single();
      const res = await cashier
        .from("products_cashier_view")
        .update({ selling_price_cents: 1, stock_quantity: 424242 })
        .eq("id", productId)
        .select("id");
      expect(res.error).not.toBeNull();
      expect(await stock()).toEqual(before);
      const { data: after } = await owner
        .from("products")
        .select("selling_price_cents")
        .eq("id", productId)
        .single();
      expect(after).toEqual(prices);
    });

    it("cannot write through any cashier view", async () => {
      const sale = await cashier
        .from("sale_items_cashier_view")
        .insert({ sale_id: ownSaleId, product_id: productId, quantity: 1, unit_price_cents: 1 });
      const adj = await cashier.from("stock_adjustments_cashier_view").insert({
        product_id: productId,
        quantity_delta: 10,
        reason: "count_correction",
        created_by: cashierId,
      });
      const del = await cashier
        .from("products_cashier_view")
        .delete()
        .eq("id", productId)
        .select("id");
      expect(sale.error).not.toBeNull();
      expect(adj.error).not.toBeNull();
      expect(del.error).not.toBeNull();
    });

    it("cannot insert a purchase or purchase line", async () => {
      const head = await cashier
        .from("purchases")
        .insert({ created_by: cashierId, notes: "ZZ-LIVE C06" });
      const line = await cashier.from("purchase_items").insert({
        purchase_id: randomUUID(),
        product_id: productId,
        quantity: 100,
        unit_cost_cents: 1,
      });
      expect(head.error).not.toBeNull();
      expect(line.error).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("owner direct writes that bypass the void/stock logic are refused (U01)", () => {
    it("cannot rewrite a sale's total or delete a sale (void_sale is the only way back)", async () => {
      const id = await recordSale(cashier);
      const before = await sale(id);
      const upd = await owner.from("sales").update({ total_cents: 1 }).eq("id", id).select("id");
      const del = await owner.from("sales").delete().eq("id", id).select("id");
      expect(rowsTouched(upd)).toBe(0);
      expect(rowsTouched(del)).toBe(0);
      expect(await sale(id)).toEqual(before);
    });

    it("cannot add lines to an existing or voided sale", async () => {
      const before = await lineCount(voidedSaleId);
      const res = await owner.from("sale_items").insert({
        sale_id: voidedSaleId,
        product_id: productId,
        quantity: 1,
        unit_price_cents: 0,
        discount_cents: 0,
      });
      expect(res.error).not.toBeNull();
      expect(await lineCount(voidedSaleId)).toBe(before);
    });

    it("cannot rewrite or delete a customer payment", async () => {
      const id = randomUUID();
      await cashier.rpc("record_customer_payment", {
        p_payment_id: id,
        p_customer_id: customerId,
        p_amount_cents: 700,
        p_method: "cash",
      });
      const upd = await owner
        .from("customer_payments")
        .update({ amount_cents: 1 })
        .eq("id", id)
        .select("id");
      const del = await owner.from("customer_payments").delete().eq("id", id).select("id");
      expect(rowsTouched(upd)).toBe(0);
      expect(rowsTouched(del)).toBe(0);
      const { data } = await owner
        .from("customer_payments")
        .select("amount_cents")
        .eq("id", id)
        .single();
      expect(Number((data as { amount_cents: number }).amount_cents)).toBe(700);
    });

    it("cannot set stock or average cost directly on a product", async () => {
      const before = await stock();
      const res = await owner
        .from("products")
        .update({ stock_quantity: 9999, current_cost_cents: 1 })
        .eq("id", productId)
        .select("id");
      expect(res.error).not.toBeNull();
      expect(await stock()).toEqual(before);
    });

    it("cannot edit or delete a stock adjustment after the fact", async () => {
      const { data } = await owner
        .from("stock_adjustments")
        .select("id")
        .eq("product_id", productId)
        .limit(1);
      const id = (data as { id: string }[])[0].id;
      const upd = await owner
        .from("stock_adjustments")
        .update({ quantity_delta: 500 })
        .eq("id", id)
        .select("id");
      const del = await owner.from("stock_adjustments").delete().eq("id", id).select("id");
      expect(rowsTouched(upd)).toBe(0);
      expect(rowsTouched(del)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("an anonymous caller (no sign-in) can do nothing", () => {
    const calls: [string, Record<string, unknown>][] = [
      [
        "record_sale",
        {
          p_sale_id: "00000000-0000-0000-0000-000000000000",
          p_customer_id: null,
          p_payment_method: "cash",
          p_discount_cents: 0,
          p_lines: [],
          p_occurred_at: new Date().toISOString(),
        },
      ],
      ["void_sale", { p_sale_id: "00000000-0000-0000-0000-000000000000", p_reason: "x" }],
      ["void_purchase", { p_purchase_id: "00000000-0000-0000-0000-000000000000", p_reason: "x" }],
      ["preview_void_purchase", { p_purchase_id: "00000000-0000-0000-0000-000000000000" }],
      [
        "receive_delivery",
        {
          p_operation_id: "00000000-0000-0000-0000-000000000000",
          p_supplier_id: null,
          p_notes: null,
          p_lines: [],
          p_price_updates: [],
          p_delivery_date: null,
        },
      ],
      [
        "record_customer_payment",
        {
          p_payment_id: "00000000-0000-0000-0000-000000000000",
          p_customer_id: "00000000-0000-0000-0000-000000000000",
          p_amount_cents: 1,
          p_method: "cash",
        },
      ],
      ["batch_update_selling_prices", { p_updates: [] }],
      ["report_summary", { p_from: "2026-01-01T00:00:00Z", p_to: "2027-01-01T00:00:00Z" }],
      ["report_inventory_value", {}],
      ["store_timezone", {}],
      ["is_owner", {}],
    ];

    // Refused by privileges, not by a check inside the function: an internal
    // "owner only" error still means anon reached the function body.
    it.each(calls)("has no EXECUTE on %s", async (fn, args) => {
      const res = await anon.rpc(fn, args);
      expect(res.error?.message ?? "no error").toMatch(/permission denied for function/);
    });

    it.each([
      "customer_balances",
      "product_sales_30d",
      "expiring_batches",
      "negative_stock_products",
      "purchase_summaries",
      "sale_line_economics",
      "sale_items_cashier_view",
      "stock_adjustments_cashier_view",
      "cost_history",
      "categories",
      "suppliers",
      "sales",
      "sale_items",
      "customers",
      "customer_payments",
      "products",
      "products_cashier_view",
      "purchases",
      "stock_adjustments",
      "store_settings",
      "profiles",
    ])("has no SELECT on %s", async (table) => {
      // Views run as their owner and skip RLS, so "zero rows" is not enough:
      // the anon role must have no privilege at all.
      const res = await anon.from(table).select("*").limit(1);
      expect(res.error?.message ?? `read ${rowsTouched(res)} rows`).toMatch(/permission denied/);
    });

    it("cannot insert a customer or a sale", async () => {
      const c = await anon.from("customers").insert({ name: "ZZ-LIVE C06 anon" });
      const s = await anon.from("sales").insert({
        id: randomUUID(),
        cashier_id: cashierId,
        payment_method: "cash",
        total_cents: 1,
      });
      expect(c.error).not.toBeNull();
      expect(s.error).not.toBeNull();
    });
  });
});
