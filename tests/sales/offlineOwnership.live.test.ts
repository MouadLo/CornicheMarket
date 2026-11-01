/**
 * Audit C05, live. The REAL queue and sync code, the REAL Supabase client and
 * two REAL accounts against a local database:
 *
 *   A (cashier) rings up a sale offline -> A signs out -> B (the owner) signs in
 *   -> B's device syncs. Before the fix the sale was recorded under B. Now it is
 *   not sent until A signs back in, and then it is credited to A.
 *
 * Also proves the server side: record_sale ignores any client claim about who
 * the cashier is (it credits the caller's session), accepts an *expected*
 * cashier only as an assertion that refuses a mismatch, and the owner-only
 * recover_sale records a stranded sale as recovered-by-owner with the original
 * cashier kept in the activity log.
 *
 * ---------------------------------------------------------------------------
 * SETUP: local dev stack (`npx supabase start` + `npx supabase db reset`), then
 * SUPABASE_TEST_URL / _ANON_KEY and the owner and cashier variables:
 *
 *   npx jest tests/sales/offlineOwnership.live.test.ts
 *
 * Writes sales and "ZZ-LIVE C05" products. LOCAL ONLY.
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

// The app's Supabase client is built at import time from EXPO_PUBLIC_* values
// that Expo inlines at compile time, so give the app's module path a real client
// for the local project instead. It keeps its session in memory, like the app's
// AsyncStorage-backed one, and switching accounts works exactly as in the app.
jest.mock("../../src/lib/supabase/client", () => {
  const { createClient } = require("@supabase/supabase-js");
  const memory = new Map<string, string>();
  return {
    supabase: createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_ANON_KEY, {
      auth: {
        storage: {
          getItem: async (k: string) => memory.get(k) ?? null,
          setItem: async (k: string, v: string) => void memory.set(k, v),
          removeItem: async (k: string) => void memory.delete(k),
        },
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }),
  };
});
const mockStore = new Map<string, string>();
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

suite("a queued sale belongs to the user who rang it up (live)", () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const app = {
    supabase: undefined as unknown as SupabaseClient,
    queue: undefined as unknown as typeof import("../../src/lib/sales/offlineQueue"),
    sync: undefined as unknown as typeof import("../../src/lib/sales/useSaleSync"),
    recovery: undefined as unknown as typeof import("../../src/lib/sales/recovery"),
  };
  let admin: SupabaseClient; // a separate owner client, to read the database
  let ownerId: string;
  let cashierId: string;
  let productId: string;

  async function signInApp(email: string, password: string): Promise<string> {
    await app.supabase.auth.signOut();
    const { data, error } = await app.supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`app sign-in failed: ${error.message}`);
    return data.user.id;
  }
  const signOutApp = () => app.supabase.auth.signOut();

  function queuedSale(id: string, userId: string | undefined, priceCents = 1000) {
    const sale = app.sync.pendingSaleFrom(
      id,
      { customer_id: null, payment_method: "cash", discount_cents: 0, total_cents: priceCents },
      [
        {
          product_id: productId,
          name: "ZZ-LIVE C05",
          unit: "piece",
          quantity: 1,
          unit_price_cents: priceCents,
          discount_cents: 0,
          unit_cost_cents: null,
        },
      ],
      userId as string
    );
    if (userId === undefined) delete (sale as { cashier_id?: string }).cashier_id;
    return sale;
  }

  async function recorded(saleId: string) {
    const { data, error } = await admin.from("sales").select("*").eq("id", saleId).maybeSingle();
    if (error) throw new Error(error.message);
    return data as { id: string; cashier_id: string; recovered_by_owner?: boolean } | null;
  }

  beforeAll(async () => {
    app.supabase = require("../../src/lib/supabase/client").supabase;
    app.queue = require("../../src/lib/sales/offlineQueue");
    app.sync = require("../../src/lib/sales/useSaleSync");
    try {
      app.recovery = require("../../src/lib/sales/recovery");
    } catch {
      // Not written yet (failing-first): the tests that need it fail with a clear error.
    }

    admin = createClient(url as string, anonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.signInWithPassword({
      email: ownerEmail as string,
      password: ownerPassword as string,
    });
    if (error) throw new Error(error.message);
    ownerId = data.user.id;
    const cashier = createClient(url as string, anonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    cashierId = (
      await cashier.auth.signInWithPassword({
        email: cashierEmail as string,
        password: cashierPassword as string,
      })
    ).data.user?.id as string;

    const product = await admin
      .from("products")
      .insert({
        name: `ZZ-LIVE C05 ${randomUUID().slice(0, 8)}`,
        selling_price_cents: 1000,
        unit: "piece",
      })
      .select("id")
      .single();
    if (product.error) throw new Error(product.error.message);
    productId = (product.data as { id: string }).id;
  });

  beforeEach(async () => {
    mockStore.clear();
    await signOutApp();
  });
  afterAll(async () => {
    await signOutApp();
    await admin?.auth.signOut();
  });

  describe("the audit's sequence: A queues offline, A signs out, B signs in", () => {
    it("B's device sync does NOT record A's sale under B", async () => {
      const aId = await signInApp(cashierEmail as string, cashierPassword as string);
      expect(aId).toBe(cashierId);
      const saleId = randomUUID();
      await app.queue.enqueueSale(queuedSale(saleId, aId)); // rung up offline, under A
      await signOutApp(); // A signs out with the sale still pending

      const bId = await signInApp(ownerEmail as string, ownerPassword as string);
      expect(bId).toBe(ownerId);
      await app.sync.syncPendingSales(bId); // B's device runs its sync

      expect(await recorded(saleId)).toBeNull(); // not under B, not at all yet
      expect((await app.queue.listPendingSales()).map((s) => s.id)).toEqual([saleId]); // still queued, untouched
    });

    it("when A signs back in, the sale is recorded under A, once, with its original id", async () => {
      const aId = await signInApp(cashierEmail as string, cashierPassword as string);
      const saleId = randomUUID();
      await app.queue.enqueueSale(queuedSale(saleId, aId));
      await signOutApp();
      const bId = await signInApp(ownerEmail as string, ownerPassword as string);
      await app.sync.syncPendingSales(bId);
      await signOutApp();

      await signInApp(cashierEmail as string, cashierPassword as string);
      await app.sync.syncPendingSales(aId);

      const row = await recorded(saleId);
      expect(row?.cashier_id).toBe(cashierId);
      expect(await app.queue.listPendingSales()).toEqual([]);
      // Syncing again must not add a second copy.
      await app.sync.syncPendingSales(aId);
      const { data } = await admin.from("sales").select("id").eq("id", saleId);
      expect(data).toHaveLength(1);
    });

    it("a legacy sale (no user id) is never sent by either account", async () => {
      const saleId = randomUUID();
      await app.queue.enqueueSale(queuedSale(saleId, undefined));
      for (const [email, password] of [
        [cashierEmail, cashierPassword],
        [ownerEmail, ownerPassword],
      ] as const) {
        const id = await signInApp(email as string, password as string);
        await app.sync.syncPendingSales(id);
        await signOutApp();
      }
      expect(await recorded(saleId)).toBeNull();
      expect((await app.queue.listPendingSales()).map((s) => s.id)).toEqual([saleId]);
    });
  });

  describe("the server never trusts a client-supplied cashier", () => {
    async function recordAs(
      email: string,
      password: string,
      expected: string | null,
      saleId = randomUUID()
    ) {
      const c = createClient(url as string, anonKey as string, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await c.auth.signInWithPassword({ email, password });
      const res = await c.rpc("record_sale", {
        p_sale_id: saleId,
        p_customer_id: null,
        p_payment_method: "cash",
        p_discount_cents: 0,
        p_lines: [
          { product_id: productId, quantity: 1, unit_price_cents: 1000, discount_cents: 0 },
        ],
        p_occurred_at: new Date().toISOString(),
        ...(expected ? { p_expected_cashier: expected } : {}),
      });
      return { id: saleId, error: res.error };
    }

    it("credits the caller's session, whatever the device says", async () => {
      const { id, error } = await recordAs(ownerEmail as string, ownerPassword as string, null);
      expect(error).toBeNull();
      expect((await recorded(id))?.cashier_id).toBe(ownerId);
    });

    it("an expected cashier that is not the caller is refused, and nothing is recorded", async () => {
      const { id, error } = await recordAs(
        ownerEmail as string,
        ownerPassword as string,
        cashierId
      );
      expect(error?.message ?? "recorded").toMatch(/another user/);
      expect(await recorded(id)).toBeNull();
    });

    it("an expected cashier that matches the caller is fine, and a retry is idempotent", async () => {
      const first = await recordAs(cashierEmail as string, cashierPassword as string, cashierId);
      expect(first.error).toBeNull();
      const again = await recordAs(
        cashierEmail as string,
        cashierPassword as string,
        cashierId,
        first.id
      );
      expect(again.error).toBeNull();
      const { data } = await admin.from("sales").select("id").eq("id", first.id);
      expect(data).toHaveLength(1);
    });
  });

  describe("owner recovery of a sale left by a user who cannot sign back in", () => {
    const recoverArgs = (saleId: string, original: string | null) => ({
      p_sale_id: saleId,
      p_customer_id: null,
      p_payment_method: "cash",
      p_discount_cents: 0,
      p_lines: [{ product_id: productId, quantity: 1, unit_price_cents: 1000, discount_cents: 0 }],
      p_occurred_at: new Date().toISOString(),
      p_original_cashier_id: original,
    });

    it("a cashier cannot recover (or re-attribute) anything", async () => {
      const c = createClient(url as string, anonKey as string, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await c.auth.signInWithPassword({
        email: cashierEmail as string,
        password: cashierPassword as string,
      });
      const saleId = randomUUID();
      const res = await c.rpc("recover_sale", recoverArgs(saleId, cashierId));
      expect(res.error).not.toBeNull();
      expect(await recorded(saleId)).toBeNull();
    });

    it("the owner recovers it: recorded as recovered-by-owner, the original cashier kept in the log", async () => {
      const saleId = randomUUID();
      const res = await admin.rpc("recover_sale", recoverArgs(saleId, cashierId));
      expect(res.error).toBeNull();
      expect(res.data).toBe(true);

      const row = await recorded(saleId);
      expect(row?.cashier_id).toBe(ownerId); // not credited to the cashier on the device's say-so
      expect(row?.recovered_by_owner).toBe(true);

      const { data: log } = await admin
        .from("activity_log")
        .select("action, actor_id, details")
        .eq("entity_id", saleId)
        .eq("action", "sale_recovered");
      expect(log).toHaveLength(1);
      expect((log as { actor_id: string }[])[0].actor_id).toBe(ownerId);
      expect(
        (log as { details: { original_cashier_id: string } }[])[0].details.original_cashier_id
      ).toBe(cashierId);
    });

    it("recovering the same sale twice changes nothing the second time", async () => {
      const saleId = randomUUID();
      await admin.rpc("recover_sale", recoverArgs(saleId, cashierId));
      const second = await admin.rpc("recover_sale", recoverArgs(saleId, cashierId));
      expect(second.error).toBeNull();
      expect(second.data).toBe(false);
      const { data } = await admin
        .from("activity_log")
        .select("id")
        .eq("entity_id", saleId)
        .eq("action", "sale_recovered");
      expect(data).toHaveLength(1);
    });

    it("a sale the original cashier already synced is left as theirs (nothing is overwritten)", async () => {
      const saleId = randomUUID();
      const aId = await signInApp(cashierEmail as string, cashierPassword as string);
      await app.queue.enqueueSale(queuedSale(saleId, aId));
      await app.sync.syncPendingSales(aId);
      await signOutApp();

      const res = await admin.rpc("recover_sale", recoverArgs(saleId, cashierId));
      expect(res.error).toBeNull();
      expect(res.data).toBe(false);
      expect((await recorded(saleId))?.cashier_id).toBe(cashierId);
    });

    it("a legacy sale is recovered with an unknown original cashier", async () => {
      const saleId = randomUUID();
      const res = await admin.rpc("recover_sale", recoverArgs(saleId, null));
      expect(res.error).toBeNull();
      const { data: log } = await admin
        .from("activity_log")
        .select("details")
        .eq("entity_id", saleId)
        .eq("action", "sale_recovered");
      expect(
        (log as { details: { original_cashier_id: string | null } }[])[0].details
          .original_cashier_id
      ).toBeNull();
    });

    it("the whole device flow: the owner recovers a stranded queue entry and it leaves the queue", async () => {
      const saleId = randomUUID();
      await signInApp(cashierEmail as string, cashierPassword as string);
      await app.queue.enqueueSale(queuedSale(saleId, cashierId));
      await signOutApp(); // the cashier never comes back

      await signInApp(ownerEmail as string, ownerPassword as string);
      const [stranded] = await app.queue.listSalesOfOthers(ownerId);
      expect(stranded.id).toBe(saleId);
      const outcome = await app.recovery.recoverQueuedSale(stranded);

      expect(outcome).toBe("recovered");
      expect((await recorded(saleId))?.cashier_id).toBe(ownerId);
      expect(await app.queue.listPendingSales()).toEqual([]);
    });
  });
});
