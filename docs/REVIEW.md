# Corniche Market — Code Review

_Reviewed 2026-10-25. No code was changed to produce this document._

---

## 1. Architecture Map

### Folder layout

```
app/                      Expo Router screens (file-based routing)
  (app)/                  Authenticated section (guarded by _layout.tsx)
    sell/                 POS: index (cart), history, credit, void
    products/             Catalog: list, new, edit ([id]), import, price history
    stock-in/             Receiving: index, adjust, count, expiring, history, low-stock
    reports/              Single screen with all analytics
    settings.tsx          Language, backup/export, invite cashier
  sign-in.tsx / accept-invite.tsx / index.tsx
src/
  components/             Shared UI components
    sell/                 CartLineRow, PaymentSheet, ContinuousScanner
    products/             ProductForm, ProductRow, BulkPriceModal, BarcodeScannerModal
    stock/                StockInLine, ProductSearchPicker, PriceHistoryChart
    reports/              MiniBarChart
    BigButton.tsx         Primary button primitive
  lib/
    auth/                 AuthProvider (session + profile context)
    supabase/client.ts    Single Supabase client instance
    money.ts              All money/quantity arithmetic
    sales/
      totals.ts           Cart math (lineTotal, saleTotal, profit)
      offlineQueue.ts     AsyncStorage queue for pending sales
      useSaleSync.ts      NetInfo + sync loop hook
      queries.ts          submitSale (RPC), fetchCustomers, voidSale
      useKeyboardWedge.ts USB barcode scanner on web
    products/
      queries.ts          CRUD + search + bulkAdjust
      csv.ts              Parse/validate/export CSV
      import.ts           Bulk insert via chunked Supabase calls
    stock/
      queries.ts          Suppliers, purchases, price history
      pricing.ts          Price change %, significance, suggested price
    inventory/
      queries.ts          Low stock, sales velocity, adjustments, expiry batches
      reorder.ts          Reorder quantity math
    reports/
      queries.ts          8 RPC wrappers (report_summary, report_daily_trend, …)
      math.ts             TS mirror of SQL discount allocation and margin math
      ranges.ts           Date range resolution (today/7d/30d/month/custom)
  i18n/
    fr.ts                 Source of truth (exports Translations type)
    en.ts / ar.ts         Must match fr.ts structure (enforced by TypeScript)
    index.ts              i18next setup, AsyncStorage language persistence, RTL
supabase/
  migrations/             15 SQL files (extensions → schema → triggers → RLS)
  functions/invite-cashier  Edge Function for user invite
tests/
  money/, sales/, products/, reports/, stock/, inventory/   Pure-function unit tests
```

### Data flow: UI → state → Supabase

```
Screen component
  │  calls lib/*/queries.ts functions
  │  (lib files are the only place supabase.* is imported*)
  ▼
Supabase PostgREST / RPC
  │  triggers run server-side (apply_purchase_item,
  │  apply_sale_item_stock, apply_stock_adjustment)
  │  unit_cost_cents stamped by trg_sale_items_before_insert
  ▼
Postgres tables
```

_*Two exceptions: `settings.tsx:161` calls `supabase.functions.invoke` directly, and `accept-invite.tsx:21` calls `supabase.auth.updateUser`. Both are one-liners with no shared logic, so extracting them would add ceremony without benefit._

### Where business logic lives

| Concern | Location |
|---|---|
| Money arithmetic | `src/lib/money.ts` |
| Cart totals / profit | `src/lib/sales/totals.ts` |
| Weighted average cost (client mirror) | `src/lib/money.ts:weightedAverageCost` |
| Stock / WAC writes | **DB triggers only** (migrations 6, 7, 8) |
| Cost stamping on sale | **DB trigger** `trg_sale_items_before_insert` |
| Reorder quantity | `src/lib/inventory/reorder.ts` |
| Price change significance | `src/lib/stock/pricing.ts` |
| Discount allocation across lines | `src/lib/reports/math.ts` (mirrors SQL view) |
| Cashier data isolation | RLS + `products_cashier_view`, `sale_items_cashier_view` |
| Offline queue | `src/lib/sales/offlineQueue.ts` + `useSaleSync.ts` |

---

## 2. Problems, Ranked by Risk

### HIGH — Could corrupt money or stock data

#### H1 · Sequential selling-price updates in `stock-in/index.tsx:116-119`

```tsx
// app/(app)/stock-in/index.tsx:114-120
await createPurchase(supplierId, validLines, profile.id, notes.trim() || null);
for (const line of lines) {
  if (line.newSellingPriceCents !== null) {
    await updateSellingPrice(line.product.id, line.newSellingPriceCents);
  }
}
```

If the purchase is saved but a selling-price update fails halfway through, some products get the new price and others keep the old one with no error shown to the user. The stock delivery is already committed; the partial price update is silent.

**Fix:** wrap the price updates in a `Promise.all`, catch failures, and show a specific warning ("Delivery saved. Could not update price for: X").

#### H2 · Inline delivery-total calculation duplicates `lineTotalCents`

```tsx
// app/(app)/stock-in/index.tsx:102-105
const total = validLines.reduce(
  (sum, line) => sum + Math.round(line.unit_cost_cents * line.quantity),
  0
);
```

`src/lib/money.ts` exports `lineTotalCents(quantity, unitPriceCents)` which does the same `Math.round`. Using a local formula instead of the shared one means the display total could diverge from the actual total the DB computes if the rounding logic ever changes. Not wrong today, but a maintenance trap.

**Fix:** replace with `lineTotalCents` from `money.ts`.

#### H3 · `ADJUSTMENT_REASONS` labels hardcoded in English inside the data layer

```ts
// src/lib/inventory/queries.ts:6-11
export const ADJUSTMENT_REASONS: { value: AdjustmentReason; label: string }[] = [
  { value: "damaged", label: "Damaged" },
  ...
];
```

These labels are rendered in `stock-in/adjust.tsx` and `count.tsx`. In Arabic or French the user sees English reason labels. More critically, the label is exported from a lib file (not a component), so it bypasses the i18n system entirely.

**Fix:** remove the `label` field from this constant; derive labels in the component via `t('stockIn.adjustReason...')`.

#### H4 · AuthProvider silently drops profile fetch errors

```tsx
// src/lib/auth/AuthProvider.tsx:62-70
supabase.from("profiles").select("id, full_name, role")
  .eq("id", session.user.id)
  .single()
  .then(({ data }) => {
    if (mounted) {
      setProfile(data as Profile | null);  // no error branch
      setProfileLoaded(true);
    }
  });
```

If the `profiles` row is missing or the RLS policy blocks the read, `data` is `null`. `profile` stays `null`, so `isOwner` is `false` and the app silently treats the user as a cashier with no explanation. A missing profile row could happen after a failed invite.

**Fix:** add an `.catch` branch that sets a top-level error state and renders a "sign out and contact your admin" message.

---

### MEDIUM — Functional issues or tech debt that could become high-risk

#### M1 · `reports/index.tsx` is 526 lines with 8 state variables and `buildTables` duplicating translation

The `buildTables()` function at line 120 builds CSV/PDF export tables with **hardcoded English strings** (column names like `"Revenue"`, `"Profit"`, `"Last sold"`) even though the screen renders translated labels. The exported file is always English regardless of language setting.

Additionally, the screen holds 8 separate `useState` calls for report data (lines 46-55). A state reset on range change (e.g. when tabs flicker) partially clears data.

**Fix (two independent steps):**
1. Move `buildTables` to accept translated strings as arguments, or call `t()` inside it (the function is a local closure inside the component, so `t` is in scope — just use it).
2. Consolidate the 8 data states into a single `reportData: ReportData | null` object so they always update atomically.

#### M2 · `sell/index.tsx:93` — no-op branch for "kg" unit quantity

```tsx
// app/(app)/sell/index.tsx:93
quantity: product.unit === "kg" ? 1 : 1,
```

This condition always evaluates to `1`. The intent was to set a fractional default for kg items (e.g. `0.1` or `1`). As written it has no effect, but it signals that kg-unit behaviour was considered and not implemented.

**Fix:** delete the ternary and just write `quantity: 1`. If a kg default other than 1 is ever needed, it can be added then.

#### M3 · `ProductForm.tsx` (308 lines) — barcode duplicate-check fires on every keystroke via debounced effect

```tsx
// src/components/products/ProductForm.tsx:56-71
const timer = setTimeout(async () => {
  const existing = await findByBarcode(trimmed, true);
  ...
}, 400);
```

`findByBarcode` always queries the owner view (`isOwner = true`), even when `ProductForm` is called from a cashier context (which is currently blocked by `Redirect`, but the hardcoded `true` is fragile if access ever changes).

**Fix:** pass `isOwner` to `ProductForm` as a prop and thread it through to `findByBarcode`.

#### M4 · `inventory/queries.ts:fetchRecentAdjustments` — two completely different query paths

The function has an `if (isOwner)` branch (lines 89-108) that does a join and manual mapping, and an `else` branch (lines 110-117) that hits a cashier view. The owner branch casts the `products` relation as `Record<string, unknown>` and re-assembles the record by hand.

**Fix:** introduce a `stock_adjustments_owner_view` that matches `AdjustmentRecord` shape, so both branches can return typed rows without manual mapping.

#### M5 · No retry cap in the offline sale queue

`useSaleSync.ts` increments `attempts` on each failure but never stops retrying. A sale that fails due to a permanent server error (e.g. constraint violation) will be retried every time the device comes online, forever. The queue grows stale and the sync badge will always show a pending count.

**Fix:** in `useSaleSync`, skip sales with `attempts >= MAX_ATTEMPTS` (e.g. 5), emit a visible alert, and offer a "discard" button.

#### M6 · `src/i18n/index.ts` language switch requires app restart on native

The code calls `I18nManager.forceRTL()` and shows a "restart required" toast. On iOS this works; on Android `forceRTL` is not effective without an Activity restart. There is no mechanism to trigger that restart programmatically.

This is a known React Native limitation, but the user receives no guidance beyond the generic toast. No issue with data, but confusing UX.

#### M7 · `reports/index.tsx:buildTables` called inside render, re-created every render

`buildTables()` is defined inside the component and called at render time (line 369, inside the button's `onPress`). Because it closes over `summary`, `daily`, `categories`, etc., it rebuilds all export tables on every press. This is fine today but will be slow with large datasets.

**Fix:** wrap in `useMemo` or move to a standalone module.

---

### LOW — Style, dead code, or minor inconsistencies

#### L1 · `components/__tests__/ThemedText-test.tsx` tests scaffolding code that is not used in the app

`components/ThemedText.tsx` and `ThemedView.tsx` are only referenced by `app/+not-found.tsx`. The Expo scaffolding test in `components/__tests__/` has no relation to the actual app logic. It's misleading noise in the test output.

**Fix:** delete `components/ThemedText.tsx`, `components/ThemedView.tsx`, `components/__tests__/`, update `+not-found.tsx` to use plain RN `Text`/`View`.

#### L2 · `SpaceMono` font loaded in `app/_layout.tsx:39` but never used in app screens

The font is loaded via `expo-font` but no screen or component references `SpaceMono` in a `fontFamily` style. It's dead weight in the bundle.

**Fix:** remove the `useFonts` call and the font file.

#### L3 · `react-native-gesture-handler` listed as dependency but not imported anywhere

Only `app/_layout.tsx` imports `react-native-reanimated` (as a side effect). `react-native-gesture-handler` appears in `package.json` but has no import in the codebase.

**Fix:** `npm uninstall react-native-gesture-handler` (unless gesture-based interactions are planned).

#### L4 · Several `as X` casts across query files bypass TypeScript's return type checking

Examples:
- `src/lib/products/queries.ts:84` — `(row as object)` then spread; if the Supabase schema changes, TypeScript won't catch it.
- `src/lib/sales/queries.ts:62` — `return data as Customer`.
- `src/lib/stock/queries.ts:58` — `return data as Supplier`.

These are all post-`if (error) throw` paths, so the data shape is guaranteed by the schema. They are not dangerous today, but they hide type drift if columns are renamed.

**Fix:** where the shape is a strict subset of the DB row, define a `select()` string that exactly matches the TypeScript type — PostgREST then infers the shape and the cast disappears.

#### L5 · `StockInLine.tsx:62-63` has two untranslated inline strings

```tsx
stock {product.stock_quantity} {product.unit} · sells at {formatMAD(effectiveSellingPrice)}
{lineTotal !== null ? ` · line total ${formatMAD(lineTotal)}` : ""}
```

`"stock"`, `"sells at"`, and `"line total"` are English-only.

#### L6 · `PaymentSheet.tsx:134` — `placeholder="New customer name"` not translated

Small gap left after the Phase 8 translation pass.

#### L7 · `app/(app)/stock-in/_layout.tsx:9-10` — screen titles hardcoded in English

```tsx
<Stack.Screen name="adjust" options={{ title: "Stock adjustments" }} />
<Stack.Screen name="count" options={{ title: "Stock count" }} />
```

These appear as the navigation bar title. All other screens set titles via `router.setParams` or the screen component, so these two are inconsistent.

#### L8 · `src/lib/products/csv.ts:23-32` — `IMPORT_FIELDS` labels and hints are hardcoded English

The import column-mapping UI uses these labels directly (e.g. `"Name"`, `"Barcode"`, `"Buying price"`). They are rendered in `app/(app)/products/import.tsx`.

#### L9 · `products/index.tsx:73` — untranslated fallback error string

```tsx
setError(loadError instanceof Error ? loadError.message : "Could not load products.");
```

All similar fallbacks in other screens use `t('...')` — this one was missed.

#### L10 · `src/lib/reports/ranges.ts` — `storeTimeZone` falls back to `"Africa/Casablanca"` only in `queries.ts`

`ranges.ts` does not use a timezone (it works in local date strings). `queries.ts:57-58` derives the timezone at module load time, which means it is fixed when the module is first imported. If the device timezone changes while the app is open, reports would use the stale timezone until reload.

---

## 3. Current Test Coverage

### What is tested (8 test files, all pure-function unit tests)

| File | What it covers |
|---|---|
| `tests/money/money.test.ts` | `centsToDisplay`, `displayToCents`, `formatMAD`, `weightedAverageCost`, `lineTotalCents`, `profitCents` |
| `tests/money/margin.test.ts` | `marginPercent`, `formatMargin`, `parseMoneyToCents`, `applyPercent` |
| `tests/sales/totals.test.ts` | `lineSubtotal`, `lineTotal`, `cartSubtotal`, `saleTotal`, `changeDue`, `isShortPayment`, `costOfGoods`, `saleProfit`, `totalItemCount` — including kg/fractional, discount combinations, negative profit |
| `tests/sales/offlineQueue.test.ts` | Enqueue, dequeue, dedup, ordering, markAttempt, corrupt-queue survival, clearQueue |
| `tests/products/csv.test.ts` | `guessMapping` (EN+FR headers), `parseCsv`, `validateRows` (required fields, money parse, barcode dedup, unknown category, unit validation, opening stock), `toCsv` (cost inclusion, category names, round-trip) |
| `tests/reports/math.test.ts` | `allocateSaleDiscount`, `netLineRevenue`, `averageBasketCents`, `grossMarginPercent`, `inventoryPotentialProfitCents` |
| `tests/stock/pricing.test.ts` | `priceChangePercent`, `isSignificantPriceChange`, `suggestSellingPrice` |
| `tests/inventory/reorder.test.ts` | `dailySalesRate`, `suggestedReorder`, `roundUpForUnit`, `daysOfStockLeft`, `countDiscrepancy`, `stockAfterCount`, `lossValueCents` |

The critical money path (cart → sale → profit) and the offline queue are well covered. The CSV import validation tests are thorough.

### What is NOT tested

- **Database queries** — no test touches Supabase at all. Every `queries.ts` function is untested. RPC behaviour (`record_sale`, `void_sale`, `bulk_adjust_selling_price`, all report RPCs) is only verified manually.
- **Auth flow** — `AuthProvider`, sign-in, invite-cashier, accept-invite are untested.
- **Screen components** — no React component tests. `PaymentSheet`, `ProductForm`, `StockInLine` contain conditional logic (cashier guard, barcode dedup, price suggestion) that has no automated check.
- **Offline sync** — `useSaleSync` is not tested. The `NetInfo` integration and the "stop at first failure" ordering guarantee are untested.
- **`parseMoneyToCents` edge cases** — the locale-detection logic (comma-vs-dot) has coverage for common cases but not for ambiguous inputs like `"1.234"` (could be 1234 centimes or 123400 centimes depending on locale reading).
- **i18n** — no test verifies that `en.ts` and `ar.ts` stay structurally aligned with `fr.ts` at runtime. TypeScript catches structural gaps at build time, but interpolation keys (`{{amount}}`, `{{count}}`) inside string values are not type-checked.
- **RLS / cashier isolation** — there are no integration tests that verify a cashier cannot read `current_cost_cents` or `unit_cost_cents` through any query path.

---

## 4. Refactor Plan

Each step is independent and safe to do alone. Steps within a group can be done in any order; groups are ordered by risk reduction.

### Group A — Fix the two high-risk data issues (H1, H2)

**A1** · `app/(app)/stock-in/index.tsx:116-119`  
Replace the sequential selling-price `for` loop with `Promise.all`, catch partial failures separately from the delivery save, and surface a per-product warning message.

**A2** · `app/(app)/stock-in/index.tsx:102-105`  
Replace the inline `Math.round(unit_cost_cents * quantity)` total with `lineTotalCents` imported from `src/lib/money.ts`. Add a test pinning the output to the expected centimes for a known fractional-kg delivery.

### Group B — Fix the remaining high-risk issues (H3, H4)

**B1** · `src/lib/inventory/queries.ts:6-11`  
Remove the `label` field from `ADJUSTMENT_REASONS`. In `app/(app)/stock-in/adjust.tsx` and `count.tsx`, replace `reason.label` with a `t()` call keyed on `reason.value`.

**B2** · `src/lib/auth/AuthProvider.tsx:62-70`  
Add a `.catch` (or `{ data, error }` destructure) to the profile fetch. On error, set a `profileError: string | null` value in context. In `app/_layout.tsx`, render a full-screen error if `profileError` is set.

### Group C — Silent failures and retry behaviour (M5)

**C1** · `src/lib/sales/useSaleSync.ts`  
Add a `MAX_ATTEMPTS = 5` constant. In the sync loop, skip sales where `attempts >= MAX_ATTEMPTS` and collect them in a `permanentlyFailed` array. Expose `permanentlyFailed` from the hook. In `sell/index.tsx`, show a banner for permanently failed sales with a "Discard" action.

### Group D — Untranslated strings (H3 resolved by B1, then these)

**D1** · `src/components/stock/StockInLine.tsx:62-63`  
Replace the hardcoded `"stock"`, `"sells at"`, `"line total"` substrings with translation keys (add `stockIn.stockOnShelf`, `stockIn.sellsAt`, `stockIn.lineTotal` to all three locale files).

**D2** · `src/components/sell/PaymentSheet.tsx:134`  
Replace `placeholder="New customer name"` with `placeholder={t('sell.newCustomerName')}` (add key).

**D3** · `app/(app)/stock-in/_layout.tsx:9-10`  
Set `options={{ title: t('stockIn.adjustTitle') }}` and a `t('stockIn.countIntro')` or separate key for the count screen title.

**D4** · `app/(app)/reports/index.tsx:120-197` (`buildTables`)  
Call `t()` for all column names and section titles inside `buildTables`. `t` is already in scope — the function is a closure inside the component.

**D5** · `src/lib/products/csv.ts:23-32` (`IMPORT_FIELDS`)  
Remove `label` and `hint` from `IMPORT_FIELDS`. In `app/(app)/products/import.tsx` where these are rendered, replace with `t()` calls keyed by `field.key`.

**D6** · `app/(app)/products/index.tsx:73`  
Replace `"Could not load products."` with `t('products.loadError')` (add key).

### Group E — Dead code removal (L1, L2, L3)

**E1** · Delete `components/ThemedText.tsx`, `components/ThemedView.tsx`, `components/__tests__/` and update `app/+not-found.tsx`.

**E2** · Remove `useFonts` call and the `SpaceMono` import from `app/_layout.tsx`. Delete `assets/fonts/SpaceMono-Regular.ttf`.

**E3** · `npm uninstall react-native-gesture-handler` and remove it from `app.json` if listed there.

### Group F — Type safety improvements (L4, M3, M4)

**F1** · `src/lib/products/queries.ts` — replace `(row as object)` spread pattern with explicit column selection strings that exactly match the `Product` type shape. This lets TypeScript infer the return type without casts.

**F2** · `src/components/products/ProductForm.tsx:60` — add `isOwner: boolean` prop; pass it to `findByBarcode` instead of hardcoding `true`.

**F3** · `src/lib/inventory/queries.ts:fetchRecentAdjustments` — add a `stock_adjustments_owner_view` SQL migration (migration 16) so both branches return the same view-typed rows without manual object mapping.

### Group G — Reduce `reports/index.tsx` size (M1, M7)

**G1** · Extract the 8 report data states into a single `ReportData` type and one `useState<ReportData | null>` call. Update `load()` to set the whole object atomically.

**G2** · Wrap `buildTables` in `useMemo([summary, daily, categories, topByProfit, topByQuantity, lowestMargin, deadStock, inventory])` to avoid rebuilding on unrelated renders.

**G3** · Extract `Section`, `Metric`, and `ProductTable` into `src/components/reports/`. Each is a self-contained display component with no shared state.

### Group H — Add targeted tests for untested critical paths

**H1** · Add a test for `parseMoneyToCents` with the ambiguous `"1.234"` input (document the chosen behaviour).

**H2** · Add a test for `suggestedReorder` with zero sales (should return threshold minus stock, not divide by zero).

**H3** · Add a test for `pendingSaleFrom` ensuring the `id` field round-trips through `enqueueSale` / `listPendingSales` correctly (this is the idempotency key for the offline queue).

**H4** · Add a Supabase-local (docker) integration test that verifies a cashier JWT cannot read `current_cost_cents` from any query path. This is the only test that can catch RLS regressions.
