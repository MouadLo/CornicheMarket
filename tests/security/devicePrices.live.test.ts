/**
 * Device prices (audit C06's pricing point). record_sale accepts the unit
 * price the device sends, on purpose: an offline tablet sells at the prices it
 * cached. But a price that differs from the product's selling price AT THE
 * MOMENT OF THE SALE (occurred_at) must be flagged for the owner, in the
 * sale itself and in an owner-only activity log. The sale is ALWAYS recorded:
 * a wrong price is a review item, never a refusal (money is already in the
 * till; an offline sale cannot be un-rung).
 *
 * "Allowed discounts": a line's discount_cents and the sale discount are
 * separate fields (already validated against the line and basket totals), so
 * the comparison is on unit_price_cents alone. A discounted line at the right
 * price is not a mismatch.
 *
 * ---------------------------------------------------------------------------
 * SETUP: a local dev stack (`npx supabase start` + `npx supabase db reset`),
 * then the usual SUPABASE_TEST_* variables (owner and cashier), and:
 *
 *   npx jest tests/security/devicePrices.live.test.ts
 *
 * Writes products named "ZZ-LIVE PRICE ..." and sales. LOCAL ONLY.
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(url as string, anonKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return c;
}

type Line = {
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  discount_cents?: number;
};
type LogRow = {
  id: string;
  action: string;
  actor_id: string;
  entity_id: string | null;
  details: {
    sale_id: string;
    lines: {
      product_id: string;
      device_price_cents: number;
      expected_price_cents: number;
      matches_previous_price: boolean;
    }[];
  };
};

suite("device prices are flagged, never rejected (live)", () => {
  let owner: SupabaseClient;
  let cashier: SupabaseClient;
  let anon: SupabaseClient;
  let cashierId: string;

  async function newProduct(priceCents = 1000): Promise<string> {
    const { data, error } = await owner
      .from("products")
      .insert({
        name: `ZZ-LIVE PRICE ${randomUUID().slice(0, 8)}`,
        selling_price_cents: priceCents,
        unit: "piece",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async function sell(
    lines: Line[],
    options: { occurredAt?: string; discountCents?: number; saleId?: string } = {}
  ) {
    const id = options.saleId ?? randomUUID();
    const res = await cashier.rpc("record_sale", {
      p_sale_id: id,
      p_customer_id: null,
      p_payment_method: "cash",
      p_discount_cents: options.discountCents ?? 0,
      p_lines: lines.map((l) => ({ discount_cents: 0, ...l })),
      p_occurred_at: options.occurredAt ?? new Date().toISOString(),
    });
    return { id, error: res.error };
  }

  async function saleRow(id: string) {
    const { data, error } = await owner
      .from("sales")
      .select("id, total_cents, needs_price_review")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as { id: string; total_cents: number; needs_price_review: boolean } | null;
  }

  async function logFor(saleId: string): Promise<LogRow[]> {
    const { data, error } = await owner
      .from("activity_log")
      .select("id, action, actor_id, entity_id, details")
      .eq("entity_id", saleId);
    if (error) throw new Error(error.message);
    return (data ?? []) as LogRow[];
  }

  beforeAll(async () => {
    owner = await signIn(ownerEmail as string, ownerPassword as string);
    cashier = await signIn(cashierEmail as string, cashierPassword as string);
    anon = createClient(url as string, anonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    cashierId = (await cashier.auth.getUser()).data.user?.id as string;
  });
  afterAll(async () => {
    await owner?.auth.signOut();
    await cashier?.auth.signOut();
  });

  describe("a sale at the right price", () => {
    it("is not flagged and writes nothing to the log", async () => {
      const p = await newProduct(1000);
      const { id, error } = await sell([{ product_id: p, quantity: 2, unit_price_cents: 1000 }]);
      expect(error).toBeNull();
      expect((await saleRow(id))?.needs_price_review).toBe(false);
      expect(await logFor(id)).toHaveLength(0);
    });

    it("a discounted line at the right price is not a mismatch (discounts are separate fields)", async () => {
      const p = await newProduct(1000);
      const { id, error } = await sell(
        [{ product_id: p, quantity: 2, unit_price_cents: 1000, discount_cents: 150 }],
        { discountCents: 100 }
      );
      expect(error).toBeNull();
      const row = await saleRow(id);
      expect(row?.total_cents).toBe(1750);
      expect(row?.needs_price_review).toBe(false);
      expect(await logFor(id)).toHaveLength(0);
    });
  });

  describe("a sale at the wrong price is recorded, flagged and logged", () => {
    it("a cheaper device price: sale recorded as sent, flagged, logged with both prices", async () => {
      const p = await newProduct(1000);
      const { id, error } = await sell([{ product_id: p, quantity: 3, unit_price_cents: 100 }]);
      expect(error).toBeNull();
      const row = await saleRow(id);
      expect(row?.total_cents).toBe(300); // recorded exactly as the device sent it
      expect(row?.needs_price_review).toBe(true);

      const log = await logFor(id);
      expect(log).toHaveLength(1);
      expect(log[0].action).toBe("price_mismatch");
      expect(log[0].actor_id).toBe(cashierId);
      expect(log[0].details.sale_id).toBe(id);
      expect(log[0].details.lines).toEqual([
        expect.objectContaining({
          product_id: p,
          device_price_cents: 100,
          expected_price_cents: 1000,
          matches_previous_price: false,
        }),
      ]);
    });

    it("a higher device price is flagged too (it overcharges a customer)", async () => {
      const p = await newProduct(1000);
      const { id } = await sell([{ product_id: p, quantity: 1, unit_price_cents: 5000 }]);
      expect((await saleRow(id))?.needs_price_review).toBe(true);
      expect((await logFor(id))[0].details.lines[0].expected_price_cents).toBe(1000);
    });

    it("only the mismatched lines are listed when a basket mixes right and wrong prices", async () => {
      const good = await newProduct(500);
      const bad = await newProduct(800);
      const { id } = await sell([
        { product_id: good, quantity: 1, unit_price_cents: 500 },
        { product_id: bad, quantity: 1, unit_price_cents: 1 },
      ]);
      const lines = (await logFor(id))[0].details.lines;
      expect(lines.map((l) => l.product_id)).toEqual([bad]);
    });

    it("is never rejected, whatever the price (zero, absurd, fractional quantity)", async () => {
      const p = await newProduct(1000);
      for (const price of [0, 1, 999_999_999]) {
        const { id, error } = await sell([
          { product_id: p, quantity: 0.5, unit_price_cents: price },
        ]);
        expect(error).toBeNull();
        expect(await saleRow(id)).not.toBeNull();
      }
    });

    it("a retry of the same sale id records and logs once", async () => {
      const p = await newProduct(1000);
      const saleId = randomUUID();
      const lines = [{ product_id: p, quantity: 1, unit_price_cents: 10 }];
      expect((await sell(lines, { saleId })).error).toBeNull();
      expect((await sell(lines, { saleId })).error).toBeNull();
      expect(await logFor(saleId)).toHaveLength(1);
    });
  });

  describe("the price that counts is the one effective at occurred_at", () => {
    it("a sale before a price change at the old price is fine; after it, the old price is flagged and recognised as stale", async () => {
      const p = await newProduct(1000);
      await sleep(1100);
      const beforeChange = new Date().toISOString();
      await sleep(1100);
      const { error: changeError } = await owner
        .from("products")
        .update({ selling_price_cents: 1200 })
        .eq("id", p);
      expect(changeError).toBeNull();
      await sleep(1100);
      const afterChange = new Date().toISOString();

      // Sold (per the device clock) before the change, at the old price: right.
      const early = await sell([{ product_id: p, quantity: 1, unit_price_cents: 1000 }], {
        occurredAt: beforeChange,
      });
      expect((await saleRow(early.id))?.needs_price_review).toBe(false);

      // Sold before the change at the NEW price: wrong for that moment.
      const earlyNew = await sell([{ product_id: p, quantity: 1, unit_price_cents: 1200 }], {
        occurredAt: beforeChange,
      });
      expect((await saleRow(earlyNew.id))?.needs_price_review).toBe(true);

      // Sold after the change at the new price: right.
      const late = await sell([{ product_id: p, quantity: 1, unit_price_cents: 1200 }], {
        occurredAt: afterChange,
      });
      expect((await saleRow(late.id))?.needs_price_review).toBe(false);

      // Sold after the change with a stale cached price: flagged, and the log
      // says it matches the previous price (a stale cache, not a typo).
      const stale = await sell([{ product_id: p, quantity: 1, unit_price_cents: 1000 }], {
        occurredAt: afterChange,
      });
      expect((await saleRow(stale.id))?.needs_price_review).toBe(true);
      const line = (await logFor(stale.id))[0].details.lines[0];
      expect(line.expected_price_cents).toBe(1200);
      expect(line.matches_previous_price).toBe(true);
    });

    it("a price change by the owner is recorded in the history (bulk and single edits alike)", async () => {
      const p = await newProduct(700);
      await owner.rpc("batch_update_selling_prices", {
        p_updates: [{ product_id: p, selling_price_cents: 900 }],
      });
      const { data, error } = await owner
        .from("selling_price_history")
        .select("price_cents")
        .eq("product_id", p)
        .order("effective_at");
      expect(error).toBeNull();
      expect((data as { price_cents: number }[]).map((r) => r.price_cents)).toEqual([700, 900]);
    });
  });

  describe("only the owner sees and clears the flags", () => {
    it("a cashier sees no rows and an anonymous caller is refused, for the activity log and the price history", async () => {
      // Make sure there is something to hide.
      const p = await newProduct(1000);
      await sell([{ product_id: p, quantity: 1, unit_price_cents: 1 }]);
      for (const table of ["activity_log", "selling_price_history"]) {
        const ownerRows = await owner.from(table).select("*").limit(1);
        expect(ownerRows.error).toBeNull();
        expect(ownerRows.data?.length).toBe(1);

        const c = await cashier.from(table).select("*").limit(1);
        expect(c.error === null ? c.data : c.error.message).toEqual(
          c.error === null ? [] : expect.stringMatching(/permission denied|row-level security/)
        );
        const a = await anon.from(table).select("*").limit(1);
        expect(a.error?.message ?? "readable").toMatch(/permission denied/);
      }
    });

    it("nobody can write the activity log directly", async () => {
      const row = { actor_id: cashierId, action: "price_mismatch", details: {} };
      expect((await cashier.from("activity_log").insert(row)).error).not.toBeNull();
      expect((await owner.from("activity_log").insert(row)).error).not.toBeNull();
    });

    it("the owner can dismiss a review (logged), a cashier cannot", async () => {
      const p = await newProduct(1000);
      const { id } = await sell([{ product_id: p, quantity: 1, unit_price_cents: 1 }]);
      const denied = await cashier.rpc("dismiss_price_review", { p_sale_id: id });
      expect(denied.error).not.toBeNull();
      expect((await saleRow(id))?.needs_price_review).toBe(true);

      const ok = await owner.rpc("dismiss_price_review", { p_sale_id: id });
      expect(ok.error).toBeNull();
      expect((await saleRow(id))?.needs_price_review).toBe(false);
      expect((await logFor(id)).map((r) => r.action).sort()).toEqual([
        "price_mismatch",
        "price_review_dismissed",
      ]);
    });
  });
});
