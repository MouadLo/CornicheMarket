/**
 * Divers on the server (migration 030), live: the one built-in free-amount item.
 *
 * SETUP: local dev stack, SUPABASE_TEST_* owner and cashier variables:
 *   npx jest tests/security/divers.live.test.ts
 * Writes ZZ-LIVE sales and restores the settings it changes. LOCAL ONLY.
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

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(url as string, anonKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return c;
}

suite("Divers (live)", () => {
  let owner: SupabaseClient;
  let cashier: SupabaseClient;
  let cashierId: string;
  let diversId: string;
  let regularId: string;
  let regularStock: number;

  const sell = (
    lines: object[],
    id: string = randomUUID(),
    client: SupabaseClient = cashier
  ): PromiseLike<{ id: string; error: { message: string } | null }> =>
    client
      .rpc("record_sale", {
        p_sale_id: id,
        p_customer_id: null,
        p_payment_method: "cash",
        p_discount_cents: 0,
        p_lines: lines,
        p_occurred_at: new Date().toISOString(),
      })
      .then((r) => ({ id, error: r.error }));
  const divers = (amount: number, extra: object = {}) => ({
    product_id: diversId,
    quantity: 1,
    unit_price_cents: amount,
    discount_cents: 0,
    ...extra,
  });
  const itemOf = async (saleId: string) =>
    (
      await owner
        .from("sale_items")
        .select("id, note, cost_estimated, unit_cost_cents, line_total_cents")
        .eq("sale_id", saleId)
    ).data as {
      id: string;
      note: string | null;
      cost_estimated: boolean;
      unit_cost_cents: number;
      line_total_cents: number;
    }[];
  const logOf = async (saleId: string, action: string) =>
    (
      await owner
        .from("activity_log")
        .select("actor_id, details")
        .eq("action", action)
        .eq("details->>sale_id", saleId)
    ).data as { actor_id: string; details: Record<string, unknown> }[];
  const stockOf = async (id: string) =>
    Number(
      ((await owner.from("products").select("stock_quantity").eq("id", id).single()).data as any)
        .stock_quantity
    );

  beforeAll(async () => {
    owner = await signIn(ownerEmail as string, ownerPassword as string);
    cashier = await signIn(cashierEmail as string, cashierPassword as string);
    cashierId = (await cashier.auth.getUser()).data.user!.id;
    diversId = (
      (await owner.from("products").select("id").eq("kind", "misc").single()).data as {
        id: string;
      }
    ).id;
    const p = await owner
      .from("products")
      .insert({
        name: `ZZ-LIVE DIVERS ${randomUUID().slice(0, 6)}`,
        selling_price_cents: 500,
        unit: "piece",
      })
      .select("id")
      .single();
    regularId = (p.data as { id: string }).id;
    regularStock = await stockOf(regularId);
  });
  afterAll(async () => {
    await owner?.auth.signOut();
    await cashier?.auth.signOut();
  });

  describe("the Divers product", () => {
    it("exists exactly once, and a cashier sees it without any cost column", async () => {
      const { data } = await cashier
        .from("products_cashier_view")
        .select("id, kind, track_stock, is_low_stock")
        .eq("kind", "misc");
      expect(data).toHaveLength(1);
      expect(data![0]).toMatchObject({ track_stock: false, is_low_stock: false });
      const cost = await cashier.from("products_cashier_view").select("current_cost_cents");
      expect(cost.error).not.toBeNull();
    });

    it("cannot be deactivated, deleted, retyped or tracked", async () => {
      expect(
        (await owner.from("products").update({ active: false }).eq("id", diversId)).error
      ).not.toBeNull();
      expect(
        (await owner.from("products").update({ kind: "regular" }).eq("id", diversId)).error
      ).not.toBeNull();
      expect(
        (await owner.from("products").update({ track_stock: true }).eq("id", diversId)).error
      ).not.toBeNull();
      expect((await owner.from("products").delete().eq("id", diversId)).error).not.toBeNull();
      const still = await owner.from("products").select("active, kind").eq("id", diversId).single();
      expect(still.data).toMatchObject({ active: true, kind: "misc" });
    });

    it("a second Divers cannot be created, and a regular product cannot become one", async () => {
      const dup = await owner
        .from("products")
        .insert({ name: "ZZ-LIVE second", kind: "misc", selling_price_cents: 0, unit: "piece" });
      expect(dup.error).not.toBeNull();
      expect(
        (await owner.from("products").update({ kind: "misc" }).eq("id", regularId)).error
      ).not.toBeNull();
    });
  });

  describe("a Divers sale", () => {
    it("records the amount and note, moves no stock, and estimates the cost from the margin", async () => {
      const { id, error } = await sell([divers(1200, { note: "  clé USB  " })]);
      expect(error).toBeNull();
      const [item] = await itemOf(id);
      expect(item).toMatchObject({
        note: "clé USB",
        cost_estimated: true,
        unit_cost_cents: 960, // 1200 at the default 20% margin
        line_total_cents: 1200,
      });
      expect(await stockOf(diversId)).toBe(0);
    });

    it("ignores any cost, estimate flag or note a client tries to set on a regular line", async () => {
      const { id } = await sell([
        {
          product_id: regularId,
          quantity: 1,
          unit_price_cents: 500,
          discount_cents: 0,
          note: "x",
          unit_cost_cents: 1,
          cost_estimated: true,
        },
      ]);
      const [item] = await itemOf(id);
      expect(item).toMatchObject({ note: null, cost_estimated: false });
      expect(item.unit_cost_cents).not.toBe(1);
      expect(await stockOf(regularId)).toBe(regularStock - 1);
      regularStock -= 1;
    });

    it("uses the owner's margin, and the cashier cannot read or change it", async () => {
      expect(
        (
          await owner
            .from("owner_settings")
            .update({ divers_margin_percent: 50 })
            .eq("singleton", true)
        ).error
      ).toBeNull();
      try {
        const { id } = await sell([divers(1000)]);
        expect((await itemOf(id))[0].unit_cost_cents).toBe(500);
      } finally {
        await owner
          .from("owner_settings")
          .update({ divers_margin_percent: 20 })
          .eq("singleton", true);
      }
      expect((await cashier.from("owner_settings").select("divers_margin_percent")).data).toEqual(
        []
      );
      const write = await cashier
        .from("owner_settings")
        .update({ divers_margin_percent: 95 })
        .eq("singleton", true)
        .select();
      expect(write.data ?? []).toEqual([]);
    });

    it("is not flagged for a price review (it has no list price)", async () => {
      const { id } = await sell([divers(700)]);
      const s = await owner.from("sales").select("needs_price_review").eq("id", id).single();
      expect(s.data).toMatchObject({ needs_price_review: false });
    });
  });

  describe("what record_sale refuses", () => {
    it.each([
      ["above the maximum", () => divers(20001)],
      ["a zero amount", () => divers(0)],
      ["quantity 2", () => ({ ...divers(500), quantity: 2 })],
      ["a note over 60 characters", () => divers(500, { note: "x".repeat(61) })],
    ])("%s", async (_name, line) => {
      const { id, error } = await sell([line()]);
      expect(error).not.toBeNull();
      expect((await owner.from("sales").select("id").eq("id", id)).data).toEqual([]);
    });

    it("exactly the maximum is fine, and the owner can change the maximum", async () => {
      expect((await sell([divers(20000)])).error).toBeNull();
      expect(
        (
          await owner
            .from("store_settings")
            .update({ divers_max_cents: 5000 })
            .eq("singleton", true)
        ).error
      ).toBeNull();
      try {
        expect((await sell([divers(5001)])).error).not.toBeNull();
        expect((await sell([divers(5000)])).error).toBeNull();
      } finally {
        await owner
          .from("store_settings")
          .update({ divers_max_cents: 20000 })
          .eq("singleton", true);
      }
    });

    it("a cashier can read the maximum but not change it", async () => {
      expect(
        (await cashier.from("store_settings").select("divers_max_cents").single()).data
      ).toMatchObject({
        divers_max_cents: 20000,
      });
      const write = await cashier
        .from("store_settings")
        .update({ divers_max_cents: 999999 })
        .eq("singleton", true)
        .select();
      expect(write.data ?? []).toEqual([]);
    });
  });

  describe("the activity log", () => {
    it("one divers_sale row per line, credited to the cashier, once even if re-sent", async () => {
      const id = randomUUID();
      const line = divers(850, { note: "colis" });
      expect((await sell([line], id)).error).toBeNull();
      expect((await sell([line], id)).error).toBeNull(); // the offline retry
      const rows = await logOf(id, "divers_sale");
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_id).toBe(cashierId);
      expect(rows[0].details).toMatchObject({ amount_cents: 850, note: "colis" });
    });

    it("voiding the sale adds a divers_void row and keeps the original", async () => {
      const { id } = await sell([
        divers(400, { note: "erreur" }),
        { product_id: regularId, quantity: 2, unit_price_cents: 500, discount_cents: 0 },
      ]);
      regularStock -= 2;
      expect(
        (await owner.rpc("void_sale", { p_sale_id: id, p_reason: "mistake" })).error
      ).toBeNull();
      expect(await logOf(id, "divers_sale")).toHaveLength(1);
      const voids = await logOf(id, "divers_void");
      expect(voids).toHaveLength(1);
      expect(voids[0].details).toMatchObject({
        original_cashier_id: cashierId,
        void_reason: "mistake",
        amount_cents: 400,
      });
      // The regular line's stock came back; Divers never had any.
      expect(await stockOf(regularId)).toBe(regularStock + 2);
      expect(await stockOf(diversId)).toBe(0);
      // Voiding again writes nothing more.
      await owner.rpc("void_sale", { p_sale_id: id, p_reason: "again" });
      expect(await logOf(id, "divers_void")).toHaveLength(1);
    });

    it("a cashier cannot read the log", async () => {
      expect((await cashier.from("activity_log").select("id").limit(1)).data).toEqual([]);
    });
  });
});
