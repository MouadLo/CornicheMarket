/**
 * Discount review. A line discount or a sale discount above an owner-set
 * percentage of the amount is FLAGGED for the owner, never blocked: the sale
 * is recorded exactly as sent, sales.needs_discount_review is set, and an
 * owner-only activity_log row (discount_over_threshold) says how big it was.
 *
 *   - line discount: more than the threshold % of that line's price x quantity;
 *   - sale discount: more than the threshold % of the basket after line discounts;
 *   - "exceeds" is strict: exactly the threshold is fine;
 *   - the threshold (default 10 %) lives in owner_settings, which cashiers
 *     cannot read (store_settings can be read by every signed-in user).
 *
 * ---------------------------------------------------------------------------
 * SETUP: local dev stack, SUPABASE_TEST_* variables for owner and cashier:
 *
 *   npx jest tests/security/discountReview.live.test.ts
 *
 * Changes owner_settings.discount_review_percent while it runs and restores
 * it to 10. LOCAL ONLY.
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

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(url as string, anonKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return c;
}

type LogRow = {
  action: string;
  actor_id: string;
  details: {
    threshold_percent: number;
    lines: {
      product_id: string;
      line_amount_cents: number;
      discount_cents: number;
      percent: number;
    }[];
    sale_discount: null | { discount_cents: number; basket_cents: number; percent: number };
  };
};

suite("discounts above the owner's threshold are flagged, never blocked (live)", () => {
  let owner: SupabaseClient;
  let cashier: SupabaseClient;
  let anon: SupabaseClient;
  let cashierId: string;

  async function newProduct(priceCents = 1000): Promise<string> {
    const { data, error } = await owner
      .from("products")
      .insert({
        name: `ZZ-LIVE DISC ${randomUUID().slice(0, 8)}`,
        selling_price_cents: priceCents,
        unit: "piece",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async function sell(
    productId: string,
    options: {
      quantity?: number;
      price?: number;
      lineDiscount?: number;
      saleDiscount?: number;
      saleId?: string;
    } = {}
  ) {
    const id = options.saleId ?? randomUUID();
    const res = await cashier.rpc("record_sale", {
      p_sale_id: id,
      p_customer_id: null,
      p_payment_method: "cash",
      p_discount_cents: options.saleDiscount ?? 0,
      p_lines: [
        {
          product_id: productId,
          quantity: options.quantity ?? 2,
          unit_price_cents: options.price ?? 1000,
          discount_cents: options.lineDiscount ?? 0,
        },
      ],
      p_occurred_at: new Date().toISOString(),
    });
    return { id, error: res.error };
  }

  async function sale(id: string) {
    const { data, error } = await owner
      .from("sales")
      .select("total_cents, needs_discount_review, needs_price_review")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as {
      total_cents: number;
      needs_discount_review: boolean;
      needs_price_review: boolean;
    } | null;
  }

  async function log(id: string, action = "discount_over_threshold"): Promise<LogRow[]> {
    const { data, error } = await owner
      .from("activity_log")
      .select("action, actor_id, details")
      .eq("entity_id", id)
      .eq("action", action);
    if (error) throw new Error(error.message);
    return (data ?? []) as LogRow[];
  }

  async function setThreshold(percent: number) {
    const { error } = await owner
      .from("owner_settings")
      .update({ discount_review_percent: percent })
      .eq("singleton", true);
    if (error) throw new Error(error.message);
  }

  beforeAll(async () => {
    owner = await signIn(ownerEmail as string, ownerPassword as string);
    cashier = await signIn(cashierEmail as string, cashierPassword as string);
    anon = createClient(url as string, anonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    cashierId = (await cashier.auth.getUser()).data.user?.id as string;
    await setThreshold(10);
  });
  afterAll(async () => {
    await setThreshold(10);
    await owner?.auth.signOut();
    await cashier?.auth.signOut();
  });

  describe("the setting is owner-only", () => {
    it("defaults to 10 % and the owner can read it", async () => {
      const { data, error } = await owner
        .from("owner_settings")
        .select("discount_review_percent")
        .single();
      expect(error).toBeNull();
      expect(Number((data as { discount_review_percent: number }).discount_review_percent)).toBe(
        10
      );
    });

    it("a cashier cannot read or change it, and anon is refused", async () => {
      const read = await cashier.from("owner_settings").select("*");
      expect(read.error === null ? read.data : read.error.message).toEqual(
        read.error === null ? [] : expect.stringMatching(/permission denied|row-level security/)
      );
      const write = await cashier
        .from("owner_settings")
        .update({ discount_review_percent: 100 })
        .eq("singleton", true)
        .select("singleton");
      expect(write.error === null ? write.data : "refused").toEqual(
        write.error === null ? [] : "refused"
      );
      expect((await anon.from("owner_settings").select("*")).error?.message ?? "readable").toMatch(
        /permission denied/
      );
      const { data } = await owner
        .from("owner_settings")
        .select("discount_review_percent")
        .single();
      expect(Number((data as { discount_review_percent: number }).discount_review_percent)).toBe(
        10
      );
    });

    it("refuses nonsense values", async () => {
      for (const bad of [-1, 101]) {
        expect(
          (
            await owner
              .from("owner_settings")
              .update({ discount_review_percent: bad })
              .eq("singleton", true)
          ).error
        ).not.toBeNull();
      }
    });
  });

  describe("line discounts", () => {
    it("exactly the threshold is fine; one centime more is flagged", async () => {
      const p = await newProduct();
      const atLimit = await sell(p, { lineDiscount: 200 }); // 200 / 2000 = 10 %
      expect(atLimit.error).toBeNull();
      expect((await sale(atLimit.id))?.needs_discount_review).toBe(false);
      expect(await log(atLimit.id)).toHaveLength(0);

      const over = await sell(p, { lineDiscount: 201 });
      expect(over.error).toBeNull();
      const row = await sale(over.id);
      expect(row?.total_cents).toBe(1799); // recorded exactly as sent
      expect(row?.needs_discount_review).toBe(true);
    });

    it("the log row says which line, how much, and the threshold in force", async () => {
      const p = await newProduct();
      const { id } = await sell(p, { lineDiscount: 500 }); // 25 %
      const rows = await log(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_id).toBe(cashierId);
      expect(rows[0].details.threshold_percent).toBe(10);
      expect(rows[0].details.sale_discount).toBeNull();
      expect(rows[0].details.lines).toEqual([
        expect.objectContaining({
          product_id: p,
          line_amount_cents: 2000,
          discount_cents: 500,
          percent: 25,
        }),
      ]);
    });

    it("a 100 % line discount is recorded (never blocked) and flagged", async () => {
      const p = await newProduct();
      const { id, error } = await sell(p, { lineDiscount: 2000 });
      expect(error).toBeNull();
      expect((await sale(id))?.total_cents).toBe(0);
      expect((await sale(id))?.needs_discount_review).toBe(true);
    });
  });

  describe("sale discounts", () => {
    it("measured against the basket after line discounts: exactly the threshold is fine, one centime more is flagged", async () => {
      const p = await newProduct();
      const atLimit = await sell(p, { quantity: 5, saleDiscount: 500 }); // 500 / 5000
      expect((await sale(atLimit.id))?.needs_discount_review).toBe(false);

      const over = await sell(p, { quantity: 5, saleDiscount: 501 });
      expect(over.error).toBeNull();
      expect((await sale(over.id))?.total_cents).toBe(4499);
      expect((await sale(over.id))?.needs_discount_review).toBe(true);
      expect((await log(over.id))[0].details.sale_discount).toEqual(
        expect.objectContaining({ discount_cents: 501, basket_cents: 5000 })
      );
    });

    it("the basket is the amount after line discounts", async () => {
      const p = await newProduct();
      // 5 x 10.00 = 50.00, minus a 5.00 line discount (exactly 10 %, fine) = 45.00 basket; 10 % of that is 4.50.
      const ok = await sell(p, { quantity: 5, lineDiscount: 500, saleDiscount: 450 });
      expect((await sale(ok.id))?.needs_discount_review).toBe(false);
      const over = await sell(p, { quantity: 5, lineDiscount: 500, saleDiscount: 451 });
      expect((await sale(over.id))?.needs_discount_review).toBe(true);
      expect((await log(over.id))[0].details.sale_discount).toEqual(
        expect.objectContaining({ discount_cents: 451, basket_cents: 4500 })
      );
      expect((await log(over.id))[0].details.lines).toEqual([]);
    });
  });

  describe("the owner sets the threshold", () => {
    it("a higher threshold stops flagging; 0 flags any discount", async () => {
      const p = await newProduct();
      await setThreshold(50);
      const quiet = await sell(p, { lineDiscount: 600 }); // 30 %
      expect((await sale(quiet.id))?.needs_discount_review).toBe(false);

      await setThreshold(0);
      const loud = await sell(p, { lineDiscount: 1 });
      expect((await sale(loud.id))?.needs_discount_review).toBe(true);
      const none = await sell(p);
      expect((await sale(none.id))?.needs_discount_review).toBe(false);
      await setThreshold(10);
    });
  });

  describe("it never interferes with the sale or the price review", () => {
    it("a sale with a wrong price AND a big discount gets both flags and two log rows", async () => {
      const p = await newProduct(1000);
      const { id, error } = await sell(p, { price: 100, quantity: 2, lineDiscount: 100 }); // 50 % of 200
      expect(error).toBeNull();
      const row = await sale(id);
      expect(row?.needs_price_review).toBe(true);
      expect(row?.needs_discount_review).toBe(true);
      expect(await log(id, "price_mismatch")).toHaveLength(1);
      expect(await log(id)).toHaveLength(1);
    });

    it("a retry of the same sale id records and logs once", async () => {
      const p = await newProduct();
      const saleId = randomUUID();
      expect((await sell(p, { lineDiscount: 900, saleId })).error).toBeNull();
      expect((await sell(p, { lineDiscount: 900, saleId })).error).toBeNull();
      expect(await log(saleId)).toHaveLength(1);
    });

    it("existing validation still rejects an impossible discount (more than the line)", async () => {
      const p = await newProduct();
      expect((await sell(p, { lineDiscount: 2001 })).error).not.toBeNull();
    });
  });

  describe("clearing a review", () => {
    it("the owner can dismiss it (logged); a cashier cannot", async () => {
      const p = await newProduct();
      const { id } = await sell(p, { lineDiscount: 900 });
      expect(
        (await cashier.rpc("dismiss_discount_review", { p_sale_id: id })).error
      ).not.toBeNull();
      expect((await sale(id))?.needs_discount_review).toBe(true);

      expect((await owner.rpc("dismiss_discount_review", { p_sale_id: id })).error).toBeNull();
      expect((await sale(id))?.needs_discount_review).toBe(false);
      expect(await log(id, "discount_review_dismissed")).toHaveLength(1);
      // dismissing again is a no-op
      expect((await owner.rpc("dismiss_discount_review", { p_sale_id: id })).error).toBeNull();
      expect(await log(id, "discount_review_dismissed")).toHaveLength(1);
    });
  });
});
