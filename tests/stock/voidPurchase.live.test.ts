/**
 * Proves, against a REAL Supabase database, what voiding a delivery does
 * (docs/STOCK-IN-DESIGN.md 2.1.1):
 *
 *   - both worked examples, step by step, with the exact numbers;
 *   - past sales keep the cost they were stamped with;
 *   - stock goes down by the voided quantity, even below zero;
 *   - owner only, a reason is required, the void is recorded and idempotent;
 *   - a voided delivery drops out of totals and the expiring list, can't be
 *     deleted, un-voided or added to.
 *
 * ---------------------------------------------------------------------------
 * SETUP: a local dev stack (`npx supabase start` + `npx supabase db reset`,
 * which seeds owner@corniche.local and cashier@corniche.local), then:
 *
 *   SUPABASE_TEST_URL="http://127.0.0.1:54321"
 *   SUPABASE_TEST_ANON_KEY="<anon key from `npx supabase status`>"
 *   SUPABASE_TEST_OWNER_EMAIL="owner@corniche.local"
 *   SUPABASE_TEST_OWNER_PASSWORD="owner123"
 *   SUPABASE_TEST_CASHIER_EMAIL="cashier@corniche.local"      (optional)
 *   SUPABASE_TEST_CASHIER_PASSWORD="cashier123"               (optional)
 *
 *   npx jest tests/stock/voidPurchase.live.test.ts
 *
 * Writes products named "ZZ-LIVE R5 ...", deliveries and sales. Local only:
 * never point it at production. Without the variables every test is skipped.
 * ---------------------------------------------------------------------------
 */
import { randomUUID } from "crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { EXAMPLES, type VoidExample } from "./voidExamples";

const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const ownerEmail = process.env.SUPABASE_TEST_OWNER_EMAIL;
const ownerPassword = process.env.SUPABASE_TEST_OWNER_PASSWORD;
const cashierEmail = process.env.SUPABASE_TEST_CASHIER_EMAIL;
const cashierPassword = process.env.SUPABASE_TEST_CASHIER_PASSWORD;

const configured = Boolean(url && anonKey && ownerEmail && ownerPassword);
const suite = configured ? describe : describe.skip;
const cashierIt = cashierEmail && cashierPassword ? it : it.skip;

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(url as string, anonKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

suite("void_purchase (live)", () => {
  let owner: SupabaseClient;
  let ownerId: string;

  beforeAll(async () => {
    owner = await signIn(ownerEmail as string, ownerPassword as string);
    ownerId = (await owner.auth.getUser()).data.user?.id as string;
  });
  afterAll(async () => {
    await owner?.auth.signOut();
  });

  async function newProduct(): Promise<string> {
    const { data, error } = await owner
      .from("products")
      .insert({
        name: `ZZ-LIVE R5 ${randomUUID().slice(0, 8)}`,
        selling_price_cents: 1000,
        unit: "piece",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async function state(productId: string) {
    const { data, error } = await owner
      .from("products")
      .select("stock_quantity, current_cost_cents")
      .eq("id", productId)
      .single();
    if (error) throw new Error(error.message);
    const row = data as { stock_quantity: number; current_cost_cents: number };
    return { stock: Number(row.stock_quantity), cost: Number(row.current_cost_cents) };
  }

  async function receive(
    lines: {
      product_id: string;
      quantity: number;
      unit_cost_cents: number;
      expiry_date?: string | null;
    }[],
    supplierId: string | null = null
  ): Promise<string> {
    const { data, error } = await owner.rpc("receive_delivery", {
      p_operation_id: randomUUID(),
      p_supplier_id: supplierId,
      p_notes: "ZZ-LIVE R5",
      p_lines: lines.map((l) => ({ expiry_date: null, ...l })),
      p_price_updates: [],
    });
    if (error) throw new Error(`receive_delivery: ${error.message}`);
    return data as string;
  }

  async function sell(productId: string, quantity: number): Promise<void> {
    const { error } = await owner.rpc("record_sale", {
      p_sale_id: randomUUID(),
      p_customer_id: null,
      p_payment_method: "cash",
      p_discount_cents: 0,
      p_lines: [{ product_id: productId, quantity, unit_price_cents: 1000 }],
      p_occurred_at: new Date().toISOString(),
    });
    if (error) throw new Error(`record_sale: ${error.message}`);
  }

  const voidDelivery = (id: string, reason: string, client: SupabaseClient = owner) =>
    client.rpc("void_purchase", { p_purchase_id: id, p_reason: reason });

  async function saleCosts(productId: string): Promise<number[]> {
    const { data, error } = await owner
      .from("sale_items")
      .select("unit_cost_cents")
      .eq("product_id", productId);
    if (error) throw new Error(error.message);
    return (data as { unit_cost_cents: number }[]).map((r) => Number(r.unit_cost_cents));
  }

  async function cogs(productId: string): Promise<number> {
    const { data, error } = await owner
      .from("sale_line_economics")
      .select("cost_cents")
      .eq("product_id", productId);
    if (error) throw new Error(error.message);
    return (data as { cost_cents: number }[]).reduce((sum, r) => sum + Number(r.cost_cents), 0);
  }

  describe.each(EXAMPLES.map((e) => [e.name, e] as const))(
    "worked example %s",
    (_name, example: VoidExample) => {
      it("hits every number in the doc, and past sales keep their stamped cost", async () => {
        const productId = await newProduct();
        const deliveries: Record<string, string> = {};
        let costOfGoodsBeforeVoid: number | null = null;

        for (const step of example.steps) {
          if (step.do === "receive") {
            const id = await receive([
              { product_id: productId, quantity: step.qty, unit_cost_cents: step.unitCost },
            ]);
            if (step.as) deliveries[step.as] = id;
          } else if (step.do === "sell") {
            await sell(productId, step.qty);
          } else if (step.do === "void") {
            costOfGoodsBeforeVoid = await cogs(productId);
            const { error } = await voidDelivery(deliveries[step.delivery], "ZZ-LIVE typo");
            expect(error).toBeNull();
          } else {
            expect({ note: step.note, ...(await state(productId)) }).toEqual({
              note: step.note,
              stock: step.stock,
              cost: step.cost,
            });
          }
        }

        // Every sale still carries the average cost it was stamped with...
        const costs = await saleCosts(productId);
        expect(costs.length).toBeGreaterThan(0);
        expect(new Set(costs)).toEqual(new Set([example.salesKeepCost]));
        // ...so profit already reported for those sales did not move.
        expect(await cogs(productId)).toBe(costOfGoodsBeforeVoid);
      });
    }
  );

  it("example B leaves the product on the negative-stock screen until it is re-entered", async () => {
    const productId = await newProduct();
    await receive([{ product_id: productId, quantity: 10, unit_cost_cents: 600 }]);
    const typo = await receive([{ product_id: productId, quantity: 100, unit_cost_cents: 700 }]);
    await sell(productId, 15);

    expect((await voidDelivery(typo, "ZZ-LIVE quantity typo")).error).toBeNull();

    const { data } = await owner
      .from("negative_stock_products")
      .select("stock_quantity, stock_went_negative_at")
      .eq("product_id", productId);
    const rows = data as { stock_quantity: number; stock_went_negative_at: string | null }[];
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].stock_quantity)).toBe(-5);
    expect(rows[0].stock_went_negative_at).not.toBeNull();

    await receive([{ product_id: productId, quantity: 10, unit_cost_cents: 700 }]);
    const after = await owner
      .from("negative_stock_products")
      .select("product_id")
      .eq("product_id", productId);
    expect(after.data).toEqual([]);
  });

  it("voids a multi-line delivery, correcting every product", async () => {
    const a = await newProduct();
    const b = await newProduct();
    await receive([
      { product_id: a, quantity: 10, unit_cost_cents: 500 },
      { product_id: b, quantity: 6, unit_cost_cents: 200 },
    ]);
    const typo = await receive([
      { product_id: a, quantity: 10, unit_cost_cents: 900 },
      { product_id: b, quantity: 6, unit_cost_cents: 400 },
    ]);

    expect((await voidDelivery(typo, "ZZ-LIVE wrong invoice")).error).toBeNull();

    // No sales: S*W - q*c = 20*700 - 10*900 = 5000 over 10 units, 500 each.
    expect(await state(a)).toEqual({ stock: 10, cost: 500 });
    expect(await state(b)).toEqual({ stock: 6, cost: 200 });
  });

  it("the first delivery ever, voided, returns the product to 0 stock and 0 cost", async () => {
    const productId = await newProduct();
    const first = await receive([{ product_id: productId, quantity: 12, unit_cost_cents: 350 }]);

    expect((await voidDelivery(first, "ZZ-LIVE entered on the wrong product")).error).toBeNull();

    expect(await state(productId)).toEqual({ stock: 0, cost: 0 });
  });

  it("writes a cost_history row for the void, once", async () => {
    const productId = await newProduct();
    await receive([{ product_id: productId, quantity: 20, unit_cost_cents: 500 }]);
    const typo = await receive([{ product_id: productId, quantity: 24, unit_cost_cents: 600 }]);

    await voidDelivery(typo, "ZZ-LIVE typo");
    await voidDelivery(typo, "ZZ-LIVE typo again");

    const { data } = await owner
      .from("cost_history")
      .select("cost_cents, source")
      .eq("product_id", productId)
      .eq("source", "purchase_void");
    // 44 units at 555 (554.5 rounded up), minus 24 at 600: (24420 - 14400) / 20.
    // One centime above the true 500: the stored average was already rounded.
    expect(data).toEqual([{ cost_cents: 501, source: "purchase_void" }]);
  });

  describe("recording", () => {
    it("requires a reason, and an empty or blank one changes nothing", async () => {
      const productId = await newProduct();
      const id = await receive([{ product_id: productId, quantity: 5, unit_cost_cents: 500 }]);

      for (const reason of ["", "   "]) {
        const { error } = await voidDelivery(id, reason);
        expect(error?.code).toBe("22023");
      }
      expect(await state(productId)).toEqual({ stock: 5, cost: 500 });
      const { data } = await owner.from("purchases").select("voided_at").eq("id", id).single();
      expect((data as { voided_at: string | null }).voided_at).toBeNull();
    });

    it("keeps the purchase, marked with who, when and why, and shows it in history", async () => {
      const productId = await newProduct();
      const id = await receive([{ product_id: productId, quantity: 5, unit_cost_cents: 500 }]);

      expect((await voidDelivery(id, "  ZZ-LIVE duplicate delivery  ")).error).toBeNull();

      const { data: purchase } = await owner
        .from("purchases")
        .select("voided_at, voided_by, void_reason")
        .eq("id", id)
        .single();
      const row = purchase as { voided_at: string; voided_by: string; void_reason: string };
      expect(row.voided_by).toBe(ownerId);
      expect(row.void_reason).toBe("ZZ-LIVE duplicate delivery");
      expect(Math.abs(Date.now() - new Date(row.voided_at).getTime())).toBeLessThan(60_000);

      const { data: summary } = await owner
        .from("purchase_summaries")
        .select("total_cents, voided_at, void_reason")
        .eq("id", id)
        .single();
      const s = summary as {
        total_cents: number;
        voided_at: string | null;
        void_reason: string | null;
      };
      expect(s.total_cents).toBe(2500);
      expect(s.void_reason).toBe("ZZ-LIVE duplicate delivery");
      expect(s.voided_at).not.toBeNull();
    });

    it("is idempotent: voiding again changes nothing and does not fail", async () => {
      const productId = await newProduct();
      await receive([{ product_id: productId, quantity: 20, unit_cost_cents: 500 }]);
      const typo = await receive([{ product_id: productId, quantity: 24, unit_cost_cents: 600 }]);

      const first = await voidDelivery(typo, "ZZ-LIVE first");
      const afterFirst = await state(productId);
      const second = await voidDelivery(typo, "ZZ-LIVE second");

      expect(first.error).toBeNull();
      expect(second.error).toBeNull();
      expect(await state(productId)).toEqual(afterFirst);
      const { data } = await owner.from("purchases").select("void_reason").eq("id", typo).single();
      expect((data as { void_reason: string }).void_reason).toBe("ZZ-LIVE first");
    });

    it("refuses an unknown delivery", async () => {
      const { error } = await voidDelivery(randomUUID(), "ZZ-LIVE nothing there");
      expect(error?.code).toBe("22023");
    });
  });

  describe("a voided delivery", () => {
    it("drops out of the monthly and supplier totals but not out of the list", async () => {
      const productId = await newProduct();
      const { data: supplier } = await owner
        .from("suppliers")
        .insert({ name: `ZZ-LIVE R5 supplier ${randomUUID().slice(0, 6)}` })
        .select("id")
        .single();
      const supplierId = (supplier as { id: string }).id;
      await receive([{ product_id: productId, quantity: 10, unit_cost_cents: 500 }], supplierId);
      const typo = await receive(
        [{ product_id: productId, quantity: 10, unit_cost_cents: 900 }],
        supplierId
      );

      const totalFor = async () =>
        Number(
          (
            await owner
              .from("purchase_supplier_totals")
              .select("total_cents")
              .eq("supplier_id", supplierId)
              .single()
          ).data?.total_cents
        );
      expect(await totalFor()).toBe(14000);

      await voidDelivery(typo, "ZZ-LIVE typo");

      expect(await totalFor()).toBe(5000);
      const { data: listed } = await owner.from("purchase_summaries").select("id").eq("id", typo);
      expect(listed).toHaveLength(1);
    });

    it("drops its batches out of the expiring list", async () => {
      const productId = await newProduct();
      const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
      const id = await receive([
        { product_id: productId, quantity: 10, unit_cost_cents: 500, expiry_date: soon },
      ]);
      const before = await owner.from("expiring_batches").select("id").eq("product_id", productId);
      expect(before.data).toHaveLength(1);

      await voidDelivery(id, "ZZ-LIVE typo");

      const after = await owner.from("expiring_batches").select("id").eq("product_id", productId);
      expect(after.data).toEqual([]);
    });

    it("cannot be deleted: the silent path that left stock and cost wrong is closed", async () => {
      const productId = await newProduct();
      const id = await receive([{ product_id: productId, quantity: 5, unit_cost_cents: 500 }]);

      await owner.from("purchases").delete().eq("id", id);

      const { data } = await owner.from("purchases").select("id").eq("id", id);
      expect(data).toHaveLength(1);
      expect(await state(productId)).toEqual({ stock: 5, cost: 500 });
    });

    it("cannot be un-voided or re-reasoned", async () => {
      const productId = await newProduct();
      const id = await receive([{ product_id: productId, quantity: 5, unit_cost_cents: 500 }]);
      await voidDelivery(id, "ZZ-LIVE typo");

      const unvoid = await owner
        .from("purchases")
        .update({ voided_at: null, voided_by: null, void_reason: null })
        .eq("id", id);
      const rewrite = await owner
        .from("purchases")
        .update({ void_reason: "ZZ-LIVE sneaky edit" })
        .eq("id", id);

      expect(unvoid.error).not.toBeNull();
      expect(rewrite.error).not.toBeNull();
      const { data } = await owner.from("purchases").select("void_reason").eq("id", id).single();
      expect((data as { void_reason: string }).void_reason).toBe("ZZ-LIVE typo");
    });

    it("cannot receive more stock into it", async () => {
      const productId = await newProduct();
      const id = await receive([{ product_id: productId, quantity: 5, unit_cost_cents: 500 }]);
      await voidDelivery(id, "ZZ-LIVE typo");

      const { error } = await owner
        .from("purchase_items")
        .insert({ purchase_id: id, product_id: productId, quantity: 1, unit_cost_cents: 100 });

      expect(error).not.toBeNull();
      expect(await state(productId)).toEqual({ stock: 0, cost: 0 });
    });

    it("can't be voided by marking it directly without a reason", async () => {
      const productId = await newProduct();
      const id = await receive([{ product_id: productId, quantity: 5, unit_cost_cents: 500 }]);

      const { error } = await owner
        .from("purchases")
        .update({ voided_at: new Date().toISOString() })
        .eq("id", id);

      expect(error).not.toBeNull();
      expect(await state(productId)).toEqual({ stock: 5, cost: 500 });
    });
  });

  describe("preview_void_purchase", () => {
    it("states, per line, exactly what the void then does", async () => {
      const productId = await newProduct();
      await receive([{ product_id: productId, quantity: 20, unit_cost_cents: 500 }]);
      const typo = await receive([{ product_id: productId, quantity: 24, unit_cost_cents: 600 }]);
      await sell(productId, 4);

      const { data, error } = await owner.rpc("preview_void_purchase", { p_purchase_id: typo });
      expect(error).toBeNull();
      const rows = data as {
        product_id: string;
        quantity: number;
        unit_cost_cents: number;
        stock_before: number;
        stock_after: number;
        cost_before_cents: number;
        cost_after_cents: number;
      }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ product_id: productId, unit_cost_cents: 600 });
      expect(Number(rows[0].quantity)).toBe(24);
      expect([Number(rows[0].stock_before), Number(rows[0].stock_after)]).toEqual([40, 16]);
      expect([Number(rows[0].cost_before_cents), Number(rows[0].cost_after_cents)]).toEqual([
        555, 488,
      ]);

      // And it changed nothing.
      expect(await state(productId)).toEqual({ stock: 40, cost: 555 });
      await voidDelivery(typo, "ZZ-LIVE typo");
      expect(await state(productId)).toEqual({ stock: 16, cost: 488 });
    });

    it("chains two lines of the same product in the order they were received", async () => {
      const productId = await newProduct();
      await receive([{ product_id: productId, quantity: 10, unit_cost_cents: 500 }]);
      const twoLines = await receive([
        { product_id: productId, quantity: 5, unit_cost_cents: 800 },
        { product_id: productId, quantity: 5, unit_cost_cents: 800 },
      ]);

      const { data } = await owner.rpc("preview_void_purchase", { p_purchase_id: twoLines });
      const rows = data as {
        stock_before: number;
        stock_after: number;
        cost_after_cents: number;
      }[];
      expect(rows.map((r) => [Number(r.stock_before), Number(r.stock_after)])).toEqual([
        [20, 15],
        [15, 10],
      ]);

      await voidDelivery(twoLines, "ZZ-LIVE typo");
      expect(await state(productId)).toEqual({ stock: 10, cost: Number(rows[1].cost_after_cents) });
    });
  });

  describe("owner only", () => {
    cashierIt("a cashier cannot void, preview, or mark a delivery directly", async () => {
      const productId = await newProduct();
      const id = await receive([{ product_id: productId, quantity: 5, unit_cost_cents: 500 }]);
      const cashier = await signIn(cashierEmail as string, cashierPassword as string);
      try {
        const viaRpc = await voidDelivery(id, "ZZ-LIVE cashier tries", cashier);
        expect(viaRpc.error?.code).toBe("42501");

        const preview = await cashier.rpc("preview_void_purchase", { p_purchase_id: id });
        expect(preview.error?.code).toBe("42501");

        await cashier
          .from("purchases")
          .update({ voided_at: new Date().toISOString(), void_reason: "x" })
          .eq("id", id);
        const { data } = await owner.from("purchases").select("voided_at").eq("id", id).single();
        expect((data as { voided_at: string | null }).voided_at).toBeNull();
        expect(await state(productId)).toEqual({ stock: 5, cost: 500 });
      } finally {
        await cashier.auth.signOut();
      }
    });
  });
});
