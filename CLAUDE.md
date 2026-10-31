# Corniche Market — Agent & Developer Guide

Corniche Market is a point-of-sale app for a Moroccan convenience store, built with Expo (React Native + TypeScript) and Supabase (Postgres + Auth). It tracks every product's buying price and selling price, records sales, and shows profit per product, per day, and per month. Two roles exist: **Owner** (full access, sees costs and profit) and **Cashier** (sales only, never sees costs; only the owner receives stock). The app runs on Android, iOS, and web from one codebase, works offline on mobile, and syncs sales when connectivity returns.

See [AGENTS.md](AGENTS.md) for Expo/React Native API conventions and EAS build commands.

---

## Folder map

```
app/                        Expo Router screens (file = route)
  (app)/                    Authenticated section; guarded by _layout.tsx
    sell/                   POS: cart (index), history, credit, void
    products/               Catalog: list, new, edit ([id]), import, price history
    stock-in/               Receiving: index, adjust, count, expiring, history, low-stock
    reports/                Analytics (single screen, 8 RPC calls)
    settings.tsx            Language, backup/export, invite cashier
  sign-in.tsx / accept-invite.tsx / index.tsx

src/
  components/               Presentational UI only — no Supabase imports
    sell/                   CartLineRow, PaymentSheet, ContinuousScanner
    products/               ProductForm, ProductRow, BulkPriceModal, BarcodeScannerModal
    stock/                  StockInLine, ProductSearchPicker, PriceHistoryChart
    reports/                MiniBarChart
    BigButton.tsx           Primary button primitive

  lib/                      All business logic and data access
    supabase/client.ts      Single Supabase client — import from here only
    auth/AuthProvider.tsx   Auth context (session + role)
    money.ts                ALL money/quantity arithmetic helpers
    sales/
      totals.ts             Cart math: lineTotal, saleTotal, profit, change due
      offlineQueue.ts       AsyncStorage queue (idempotent by sale.id)
      useSaleSync.ts        NetInfo + sync loop; pendingSaleFrom() helper
      queries.ts            submitSale (RPC), fetchCustomers, voidSale
    products/
      queries.ts            CRUD, search, bulkAdjustSellingPrice
      csv.ts / import.ts    CSV parse/validate/export + bulk insert
    stock/
      queries.ts            Suppliers, purchases, price history
      pricing.ts            Price change significance, suggested selling price
    inventory/
      queries.ts            Low stock, velocity, adjustments, expiry
      reorder.ts            Reorder quantity math
    reports/
      queries.ts            8 RPC wrappers (summary, trend, by-category, …)
      math.ts               Client-side mirror of SQL report calculations
      ranges.ts             Date range helpers

  i18n/
    fr.ts                   SOURCE OF TRUTH — defines the Translations type
    en.ts / ar.ts           Must implement `const x: Translations = {...}` (TypeScript enforced)
    index.ts                i18next setup, AsyncStorage language persistence, RTL toggle

supabase/migrations/        15 SQL files; apply in order (000001 → 000015)
tests/                      Pure-function unit tests, mirroring src/lib structure
docs/                       REVIEW.md (codebase audit), WORKFLOW.md (CI/CD and release guide)
```

---

## Commands

```bash
npm run start          # start Expo dev server
npm run typecheck      # tsc --noEmit
npm run lint           # expo lint (ESLint + TypeScript + React rules)
npm run test:ci        # jest --ci --runInBand (188 tests, ~0.5 s)
npm run check          # typecheck + lint + test:ci — run before every commit
npm run format         # prettier --write all source files
npm run export:ci      # expo export --platform all (catches build-time errors)
```

`npm run check` must pass before committing. The pre-commit hook (husky + lint-staged) runs lint and format on staged files automatically.

---

## Rules

### Money is always integer centimes

Every monetary value in the database is a `bigint` in centimes. Every monetary value in TypeScript is a `number` in centimes. **Never use floats for money.**

Use the helpers in `src/lib/money.ts`:

```ts
// ✅ correct
import { formatMAD, parseMoneyToCents, lineTotalCents, weightedAverageCost } from "@/src/lib/money";
formatMAD(1250)           // "12.50 DH"
parseMoneyToCents("12.50") // 1250
lineTotalCents(3, 700)    // 2100

// ❌ wrong — never do this
const total = quantity * price;          // float drift
const display = (cents / 100).toFixed(2); // bypass formatMAD
```

### Stock and cost only change through DB triggers

`products.stock_quantity` and `products.current_cost_cents` are **read-only from the app**. They are updated exclusively by three Postgres triggers:
- `apply_purchase_item` — increases stock, recalculates weighted-average cost
- `apply_sale_item_stock` — decreases stock
- `apply_stock_adjustment` — corrects stock after a count or write-off

Also: `sale_items.unit_cost_cents` is stamped server-side by `trg_sale_items_before_insert`. The client **never** sets it.

### Screens never call Supabase directly

All Supabase calls live in `src/lib/*/queries.ts`. Screens import from there.

```ts
// ✅ correct — in a screen
import { fetchProducts } from "@/src/lib/products/queries";

// ❌ wrong — in a screen
import { supabase } from "@/src/lib/supabase/client";
supabase.from("products").select("*");
```

### Cashiers cannot see cost or profit — at any layer

Cashier-facing screens must query `products_cashier_view` and `sale_items_cashier_view`, not the base tables. Use `productsSource(isOwner)` from `src/lib/products/queries.ts` which selects the right source automatically. RLS enforces this at the database level too.

### Every change to business logic needs a test

Anything in `src/lib/money.ts`, `src/lib/sales/totals.ts`, `src/lib/inventory/reorder.ts`, or any `*pricing.ts` / `*math.ts` file requires a test in `tests/`. Add to the existing file for that module rather than creating a new one.

### One feature or fix per branch; small commits

Branch naming: `name/short-description` (e.g. `mouad/supplier-notes`). Commit messages: imperative, specific ("add supplier notes field to stock-in form" not "update code"). See [docs/WORKFLOW.md](docs/WORKFLOW.md) for the full branch → PR → merge flow.

---

## Danger zones

### `src/lib/sales/offlineQueue.ts` + `useSaleSync.ts`

Sales queued offline use `sale.id` as an idempotency key so the server rejects duplicates. Never generate a new ID when re-trying a failed sale — always reuse the original. The sync loop stops at the first failure to preserve ordering. Changes here can silently break the offline-first guarantee; the tests in `tests/sales/` pin the current behavior.

### `src/components/sell/PaymentSheet.tsx` + `src/lib/sales/queries.ts`

This is the money path. `submitSale` calls `record_sale` (an RPC that wraps the entire transaction server-side). Do not add optimistic UI here — the sale is not confirmed until the RPC succeeds or lands in the offline queue.

### `supabase/migrations/`

Migrations are append-only and run in filename order. Never edit a migration that has been applied to any environment. If you need to change something, write migration `000016_…`. Before pushing a new migration, test it locally: `supabase db reset` replays all 15 files from scratch.

### `src/lib/auth/AuthProvider.tsx`

The `isOwner` flag controls everything visible to a cashier. If the profile fetch fails silently, `isOwner` defaults to `false` (cashier view). See `docs/REVIEW.md §H4` for the known bug. Do not add role checks anywhere else — always read from `useAuth()`.

### `src/i18n/fr.ts`

This file defines the `Translations` type. Adding a key here without adding it to `en.ts` and `ar.ts` will be a **TypeScript error**. Always add to all three files at the same time.

---

## How to add a new feature

**Example: adding a "notes" field to a purchase delivery.**

### 1. Write the migration

Create `supabase/migrations/20260101000016_purchase_notes.sql`:
```sql
alter table purchases add column notes text;
```
Test locally: `supabase db reset` (replays all migrations).

### 2. Update the TypeScript type

In `src/lib/stock/queries.ts`, add `notes: string | null` to the `Purchase` type and to the `select()` string.

### 3. Add i18n keys

In `src/i18n/fr.ts` add `stockIn: { ..., notesLabel: 'Notes' }`. Then add the same key to `en.ts` and `ar.ts`. TypeScript will error until all three match.

### 4. Update the data layer

In `src/lib/stock/queries.ts`, add `notes` as a parameter to `createPurchase()` and pass it in the insert.

### 5. Update the screen

In `app/(app)/stock-in/index.tsx`, add a `TextInput` for notes, read it from local state, and pass it to `createPurchase()`. Import the i18n label with `t('stockIn.notesLabel')`.

### 6. Write or extend a test

If `createPurchase` has any validation logic (e.g. max length), add a test in `tests/stock/`. If it's a pure pass-through, no test is needed for the query itself — but test any helper logic it calls.

### 7. Run the check

```bash
npm run check
```

All 188+ tests must pass. No type errors. No lint errors.

### 8. Commit and push

```bash
git add -p   # stage only what belongs to this feature
git commit -m "add notes field to purchase deliveries"
git push -u origin your-name/purchase-notes
```

Open a PR. CI runs automatically. Merge after review.
