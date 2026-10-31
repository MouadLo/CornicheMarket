/**
 * Proves, against a REAL Supabase database, that receive_delivery is the
 * single, all-or-nothing, retry-safe way to receive stock (audit C03, C07):
 *
 *   - the same operation id twice receives the stock once;
 *   - the same operation id with different details is refused (CM409);
 *   - a bad selling price rolls back the whole delivery, stock included;
 *   - an impossible expiry date is refused before anything is written;
 *   - only the owner can receive, through the RPC or around it.
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
 *   npx jest tests/stock/receiveDelivery.live.test.ts
 *
 * It writes products and deliveries named "ZZ-LIVE R1 …". Local only: never
 * point it at production. Without the variables every test is skipped.
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

const configured = Boolean(url && anonKey && ownerEmail && ownerPassword);
const suite = configured ? describe : describe.skip;
const cashierIt = cashierEmail && cashierPassword ? it : it.skip;

type Line = {
  product_id: string;
  quantity: number;
  unit_cost_cents: number;
  expiry_date: string | null;
};

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(url as string, anonKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

suite("receive_delivery (live)", () => {
  let owner: SupabaseClient;

  beforeAll(async () => {
    owner = await signIn(ownerEmail as string, ownerPassword as string);
  });
  afterAll(async () => {
    await owner?.auth.signOut();
  });

  async function newProduct(): Promise<string> {
    const { data, error } = await owner
      .from("products")
      .insert({
        name: `ZZ-LIVE R1 ${randomUUID().slice(0, 8)}`,
        selling_price_cents: 1000,
        unit: "piece",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async function product(id: string) {
    const { data, error } = await owner
      .from("products")
      .select("stock_quantity, current_cost_cents, selling_price_cents")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    const row = data as {
      stock_quantity: number;
      current_cost_cents: number;
      selling_price_cents: number;
    };
    return { ...row, stock_quantity: Number(row.stock_quantity) };
  }

  async function purchasesFor(operationId: string): Promise<number> {
    const { count, error } = await owner
      .from("purchases")
      .select("id", { count: "exact", head: true })
      .eq("operation_id", operationId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  function receive(
    client: SupabaseClient,
    operationId: string,
    lines: Line[],
    priceUpdates: { product_id: string; selling_price_cents: number }[] = [],
    extra: Record<string, unknown> = {}
  ) {
    return client.rpc("receive_delivery", {
      p_operation_id: operationId,
      p_supplier_id: null,
      p_notes: "ZZ-LIVE R1",
      p_lines: lines,
      p_price_updates: priceUpdates,
      ...extra,
    });
  }

  it("receives stock, sets the average cost and applies price changes in one call", async () => {
    const id = await newProduct();
    const op = randomUUID();

    const { data, error } = await receive(
      owner,
      op,
      [{ product_id: id, quantity: 10, unit_cost_cents: 600, expiry_date: "2026-12-31" }],
      [{ product_id: id, selling_price_cents: 1200 }]
    );

    expect(error).toBeNull();
    expect(typeof data).toBe("string");
    expect(await product(id)).toEqual({
      stock_quantity: 10,
      current_cost_cents: 600,
      selling_price_cents: 1200,
    });
    expect(await purchasesFor(op)).toBe(1);
  });

  it("the same operation id twice receives the stock once and returns the same purchase", async () => {
    const id = await newProduct();
    const op = randomUUID();
    const lines = [{ product_id: id, quantity: 10, unit_cost_cents: 600, expiry_date: null }];

    const first = await receive(owner, op, lines);
    const retry = await receive(owner, op, lines);

    expect(first.error).toBeNull();
    expect(retry.error).toBeNull();
    expect(retry.data).toBe(first.data);
    expect((await product(id)).stock_quantity).toBe(10);
    expect(await purchasesFor(op)).toBe(1);
  });

  it("the same operation id with different details is refused and changes nothing", async () => {
    const id = await newProduct();
    const op = randomUUID();
    await receive(owner, op, [
      { product_id: id, quantity: 10, unit_cost_cents: 600, expiry_date: null },
    ]);

    const edited = await receive(owner, op, [
      { product_id: id, quantity: 12, unit_cost_cents: 600, expiry_date: null },
    ]);

    expect(edited.error?.code).toBe("CM409");
    expect((await product(id)).stock_quantity).toBe(10);
    expect(await purchasesFor(op)).toBe(1);
  });

  it("a failing selling price rolls back the whole delivery, stock included", async () => {
    const id = await newProduct();
    const op = randomUUID();

    const { error } = await receive(
      owner,
      op,
      [{ product_id: id, quantity: 10, unit_cost_cents: 600, expiry_date: null }],
      [{ product_id: id, selling_price_cents: -1 }]
    );

    expect(error).not.toBeNull();
    expect(await product(id)).toEqual({
      stock_quantity: 0,
      current_cost_cents: 0,
      selling_price_cents: 1000,
    });
    expect(await purchasesFor(op)).toBe(0);
  });

  it("an impossible expiry date is refused readably and writes nothing", async () => {
    const id = await newProduct();
    const op = randomUUID();

    const { error } = await receive(owner, op, [
      { product_id: id, quantity: 5, unit_cost_cents: 500, expiry_date: "2026-02-31" },
    ]);

    expect(error?.message).toContain("2026-02-31");
    expect(await purchasesFor(op)).toBe(0);
    expect((await product(id)).stock_quantity).toBe(0);
  });

  it("refuses an empty delivery and a non-positive quantity", async () => {
    const id = await newProduct();
    expect((await receive(owner, randomUUID(), [])).error).not.toBeNull();
    expect(
      (
        await receive(owner, randomUUID(), [
          { product_id: id, quantity: 0, unit_cost_cents: 500, expiry_date: null },
        ])
      ).error
    ).not.toBeNull();
  });

  it("refuses a delivery date in the future", async () => {
    const id = await newProduct();
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const { error } = await receive(
      owner,
      randomUUID(),
      [{ product_id: id, quantity: 1, unit_cost_cents: 500, expiry_date: null }],
      [],
      { p_delivery_date: nextWeek }
    );
    expect(error).not.toBeNull();
  });

  it("a delivery dated 3 days ago lands on that day in the store's timezone", async () => {
    const id = await newProduct();
    const op = randomUUID();
    const casablancaDay = (date: Date) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" }).format(date);
    const threeDaysAgo = casablancaDay(new Date(Date.now() - 3 * 86_400_000));

    const { error } = await receive(
      owner,
      op,
      [{ product_id: id, quantity: 1, unit_cost_cents: 500, expiry_date: null }],
      [],
      { p_delivery_date: threeDaysAgo }
    );

    expect(error).toBeNull();
    const { data } = await owner
      .from("purchases")
      .select("purchase_date")
      .eq("operation_id", op)
      .single();
    expect(casablancaDay(new Date((data as { purchase_date: string }).purchase_date))).toBe(
      threeDaysAgo
    );
  });

  cashierIt(
    "a cashier cannot receive, through the RPC or by inserting a purchase directly",
    async () => {
      const id = await newProduct();
      const cashier = await signIn(cashierEmail as string, cashierPassword as string);
      try {
        const viaRpc = await receive(cashier, randomUUID(), [
          { product_id: id, quantity: 1, unit_cost_cents: 1, expiry_date: null },
        ]);
        expect(viaRpc.error?.code).toBe("42501");

        const { data: userData } = await cashier.auth.getUser();
        const direct = await cashier
          .from("purchases")
          .insert({ id: randomUUID(), created_by: userData.user?.id, notes: "ZZ-LIVE R1 cashier" });
        expect(direct.error).not.toBeNull();
        expect((await product(id)).stock_quantity).toBe(0);
      } finally {
        await cashier.auth.signOut();
      }
    }
  );
});
