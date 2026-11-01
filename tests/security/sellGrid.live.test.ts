/**
 * The Sell grid's tables (migration 029), live: everyone signed in reads the
 * layout, only the owner writes it, anon touches nothing, the constraints hold,
 * and a new category gets its tab by itself.
 *
 * SETUP: local dev stack, SUPABASE_TEST_* owner and cashier variables:
 *   npx jest tests/security/sellGrid.live.test.ts
 * Writes "ZZ-LIVE GRID" rows and removes them. LOCAL ONLY.
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

suite("sell grid tables (live)", () => {
  let owner: SupabaseClient;
  let cashier: SupabaseClient;
  let anon: SupabaseClient;
  let favoritesId: string;
  let productId: string;

  beforeAll(async () => {
    owner = await signIn(ownerEmail as string, ownerPassword as string);
    cashier = await signIn(cashierEmail as string, cashierPassword as string);
    anon = createClient(url as string, anonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    favoritesId = (
      (await owner.from("sell_grid_tabs").select("id").eq("kind", "favorites").single()).data as {
        id: string;
      }
    ).id;
    const p = await owner
      .from("products")
      .insert({
        name: `ZZ-LIVE GRID ${randomUUID().slice(0, 6)}`,
        selling_price_cents: 100,
        unit: "piece",
      })
      .select("id")
      .single();
    productId = (p.data as { id: string }).id;
  });
  afterAll(async () => {
    await owner.from("sell_grid_tiles").delete().eq("product_id", productId);
    await owner?.auth.signOut();
    await cashier?.auth.signOut();
  });

  describe("who may read and write", () => {
    it("out of the box there is a Favoris tab and one tab per category", async () => {
      const tabs = await cashier.from("sell_grid_tabs").select("kind, category_id");
      const rows = (tabs.data ?? []) as { kind: string; category_id: string | null }[];
      expect(rows.filter((r) => r.kind === "favorites")).toHaveLength(1);
      const cats = (await cashier.from("categories").select("id")).data as { id: string }[];
      expect(
        rows
          .filter((r) => r.kind === "category")
          .map((r) => r.category_id)
          .sort()
      ).toEqual(cats.map((c) => c.id).sort());
    });

    it("a cashier reads tiles too, and neither table has a cost column", async () => {
      for (const table of ["sell_grid_tabs", "sell_grid_tiles"]) {
        const res = await cashier.from(table).select("*").limit(1);
        expect(res.error).toBeNull();
        expect(Object.keys((res.data as object[])[0] ?? {}).join(",")).not.toMatch(/cost/i);
      }
    });

    it("a cashier cannot add, change or remove tabs or tiles", async () => {
      const tile = { tab_id: favoritesId, product_id: productId, position: 99 };
      expect((await cashier.from("sell_grid_tiles").insert(tile)).error).not.toBeNull();
      const upd = await cashier
        .from("sell_grid_tabs")
        .update({ visible: false })
        .eq("id", favoritesId)
        .select("id");
      const del = await cashier.from("sell_grid_tabs").delete().eq("id", favoritesId).select("id");
      expect(upd.error === null ? upd.data : []).toEqual([]);
      expect(del.error === null ? del.data : []).toEqual([]);
      const still = await owner
        .from("sell_grid_tabs")
        .select("visible")
        .eq("id", favoritesId)
        .single();
      expect((still.data as { visible: boolean }).visible).toBe(true);
    });

    it("the owner can add and remove a tile", async () => {
      const add = await owner
        .from("sell_grid_tiles")
        .insert({
          tab_id: favoritesId,
          product_id: productId,
          position: 50,
          color: "red",
          short_label: "Test",
        });
      expect(add.error).toBeNull();
      const del = await owner.from("sell_grid_tiles").delete().eq("product_id", productId);
      expect(del.error).toBeNull();
    });

    it("anon reads and writes nothing", async () => {
      for (const table of ["sell_grid_tabs", "sell_grid_tiles"]) {
        expect((await anon.from(table).select("*").limit(1)).error?.message ?? "readable").toMatch(
          /permission denied/
        );
        expect((await anon.from(table).insert({})).error?.message ?? "inserted").toMatch(
          /permission denied/
        );
      }
    });
  });

  describe("constraints", () => {
    it("only one Favoris tab", async () => {
      expect(
        (
          await owner
            .from("sell_grid_tabs")
            .insert({ kind: "favorites", position: 9, auto_fill: false })
        ).error
      ).not.toBeNull();
    });
    it("a category tab needs a category, and a favourites tab cannot have one", async () => {
      expect(
        (await owner.from("sell_grid_tabs").insert({ kind: "category", position: 9 })).error
      ).not.toBeNull();
      const cat = (await owner.from("categories").select("id").limit(1)).data as { id: string }[];
      expect(
        (
          await owner
            .from("sell_grid_tabs")
            .insert({ kind: "favorites", category_id: cat[0].id, position: 9, auto_fill: false })
        ).error
      ).not.toBeNull();
    });
    it("Favoris is never auto-filled", async () => {
      expect(
        (await owner.from("sell_grid_tabs").update({ auto_fill: true }).eq("id", favoritesId)).error
      ).not.toBeNull();
    });
    it("a product is on a tab once; colour and short label are limited", async () => {
      const base = { tab_id: favoritesId, product_id: productId, position: 1 };
      expect((await owner.from("sell_grid_tiles").insert(base)).error).toBeNull();
      expect((await owner.from("sell_grid_tiles").insert(base)).error).not.toBeNull(); // duplicate
      await owner.from("sell_grid_tiles").delete().eq("product_id", productId);
      expect(
        (await owner.from("sell_grid_tiles").insert({ ...base, color: "pink" })).error
      ).not.toBeNull();
      expect(
        (await owner.from("sell_grid_tiles").insert({ ...base, short_label: "x".repeat(25) })).error
      ).not.toBeNull();
    });
  });

  describe("categories and tabs stay in step", () => {
    it("a new category gets its tab at the end, and deleting the category removes it", async () => {
      const before = (await owner.from("sell_grid_tabs").select("position")).data as {
        position: number;
      }[];
      const max = Math.max(...before.map((r) => r.position));
      const cat = await owner
        .from("categories")
        .insert({ name: `ZZ-LIVE GRID ${randomUUID().slice(0, 6)}` })
        .select("id")
        .single();
      const id = (cat.data as { id: string }).id;
      const tab = await owner
        .from("sell_grid_tabs")
        .select("kind, position, visible, auto_fill")
        .eq("category_id", id)
        .single();
      expect(tab.data).toEqual({
        kind: "category",
        position: max + 1,
        visible: true,
        auto_fill: true,
      });
      await owner.from("categories").delete().eq("id", id);
      const gone = await owner.from("sell_grid_tabs").select("id").eq("category_id", id);
      expect(gone.data).toEqual([]);
    });

    it("deleting a product removes its tiles", async () => {
      const p = await owner
        .from("products")
        .insert({
          name: `ZZ-LIVE GRID ${randomUUID().slice(0, 6)}`,
          selling_price_cents: 1,
          unit: "piece",
        })
        .select("id")
        .single();
      const id = (p.data as { id: string }).id;
      await owner
        .from("sell_grid_tiles")
        .insert({ tab_id: favoritesId, product_id: id, position: 70 });
      await owner.from("products").delete().eq("id", id);
      expect((await owner.from("sell_grid_tiles").select("id").eq("product_id", id)).data).toEqual(
        []
      );
    });
  });
});
