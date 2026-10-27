# Pre-Launch Gap Analysis

Read-only audit of the codebase at commit `ca72f37` (branch `release/config`), done before the first real-store release. No application code was changed to produce this document.

Every claim below was verified by reading the migration SQL, the TypeScript source, or by running the arithmetic. Where I ran something to confirm a number, the result is quoted.

**Verdict: do not ship yet.** Four blockers, all small fixes. The permission model — the thing most likely to be catastrophic and hardest to retrofit — is genuinely sound; see [What is already solid](#what-is-already-solid). The blockers are in checkout and the offline path.

---

## Ranked summary

### Fix before launch (blockers)

| # | Gap | One-line consequence |
|---|---|---|
| [B1](#b1--a-line-discount-above-the-line-price-rejects-the-whole-sale) | Line discount > line price rejects the whole sale | Cashier loses the sale, sees a raw Postgres error |
| [B2](#b2--offline-sales-are-timestamped-when-they-sync-not-when-they-happened) | Offline sales timestamped at sync, not at sale | A day of offline sales all land at one minute; daily/hourly reports and cash-up are wrong |
| [B3](#b3--an-expired-token-quarantines-real-sales-instead-of-retrying) | Expired token quarantines real sales | A recoverable auth hiccup parks real money in a list nobody watches |
| [B4](#b4--stock-can-go-negative-silently) | Stock goes negative silently | Inventory valuation goes negative; no warning, no report, no way to notice |

### Fix soon after launch (important)

| # | Gap |
|---|---|
| [I1](#i1--per-line-discount-allocation-does-not-sum-to-the-sale-discount) | Line revenue does not sum to the sale total (±1 centime per discounted sale) |
| [I2](#i2--zero-cost-products-report-100-margin) | Zero-cost products report 100% margin in Reports, `—` in the product list |
| [I3](#i3--csv-export-has-no-utf-8-bom-so-arabic-names-break-in-excel) | CSV export has no BOM → Arabic names are mojibake in Excel |
| [I4](#i4--the-cart-is-lost-if-android-kills-the-app) | Cart lost if Android kills the app mid-basket |
| [I5](#i5--double-tap-on-pay-is-only-guarded-by-a-react-re-render) | Double-tap on Pay guarded only by a re-render, no latch |
| [I6](#i6--the-usb-scanner-has-no-duplicate-scan-guard) | USB scanner double-fire silently bumps quantity |
| [I7](#i7--voiding-an-old-sale-rewrites-already-closed-reports) | Voiding an old sale rewrites already-closed reports |
| [I8](#i8--1234-in-a-supplier-csv-imports-as-123-dh) | `1.234` in a supplier CSV imports as 1.23 DH (1000× error) |
| [I9](#i9--a-stale-offline-cache-can-sell-a-deactivated-product) | Stale offline cache can sell a deactivated product |

### Fix when convenient (minor)

| # | Gap |
|---|---|
| [M1](#m1--profitcents-is-dead-code-that-disagrees-with-the-sql) | `profitCents` is dead code that disagrees with the SQL in 151 cases |
| [M2](#m2--sale_line_economics-has-no-security_barrier) | `sale_line_economics` has no `security_barrier` (no reachable exploit today) |
| [M3](#m3--receipts-render-arabic-but-stay-left-aligned) | Receipts render Arabic but stay left-aligned |
| [M4](#m4--duplicate-product-names-are-allowed-with-no-warning) | Duplicate product names allowed with no warning |
| [M5](#m5--a-zero-price-product-produces-a-negative-margin) | A zero-price product produces a negative margin |

---

## Blockers

### B1 — A line discount above the line price rejects the whole sale

**What happens today.** `CartLineRow` exposes the per-line discount as a free-text field with no cap:

```
src/components/sell/CartLineRow.tsx:65
onChange({ ...line, discount_cents: value ? (parseMoneyToCents(value) ?? 0) : 0 })
```

The client then *clamps the display*, so the cashier sees a harmless `0.00`:

```
src/lib/sales/totals.ts:20
export function lineTotal(line: CartLine): number {
  return Math.max(0, lineSubtotal(...) - line.discount_cents);
}
```

But the raw, unclamped `discount_cents` is what gets sent to `record_sale`, and the server does **not** clamp at the line level:

```
supabase/migrations/20260101000007_sales.sql:44
new.line_total_cents := (new.quantity * new.unit_price_cents)::bigint - new.discount_cents;
```

against a column defined as:

```
line_total_cents bigint not null check (line_total_cents >= 0)
```

So the `before insert` trigger computes a negative value, the CHECK constraint rejects it, and the **entire transaction rolls back** — the sale row and every other line with it. The cashier sees whatever Postgres said, surfaced through the generic catch in `handleConfirm`.

A cashier fat-fingering `50` instead of `5.0` on a 12 DH item triggers this.

**How bad: Blocker.** It fails safe (no corrupt data) but it loses the sale at the counter and the error is unreadable. The UI actively hides the cause by clamping the display to 0.00.

**Covered by a test?** No. `tests/sales/totals.test.ts` tests the clamped client helper and never exercises the client/server disagreement. Nothing in the suite touches the DB constraint.

**Smallest fix.** Clamp at the point of entry so the client cannot construct the state the server rejects — one line in `CartLineRow`:

```ts
discount_cents: Math.min(parseMoneyToCents(value) ?? 0, lineSubtotal(line.quantity, line.unit_price_cents))
```

Then mirror the clamp server-side in the trigger (`greatest(0, ...)`) so no other client can reintroduce it.

---

### B2 — Offline sales are timestamped when they sync, not when they happened

**What happens today.** The device records the real sale time into the queue:

```
src/lib/sales/useSaleSync.ts  (pendingSaleFrom)
created_at: new Date().toISOString(),
```

…and then never sends it. `record_sale` takes no timestamp parameter:

```
supabase/migrations/20260101000012_sales_credit_and_void.sql:35
create function public.record_sale(
  p_sale_id uuid, p_customer_id uuid, p_payment_method payment_method,
  p_discount_cents bigint, p_lines jsonb)
```

and the insert omits `created_at`, so the column default wins:

```
created_at timestamptz not null default now()
```

`now()` is the **server** clock at insert time. A shop that sells offline from 08:00 and reconnects at 19:00 gets every one of those sales stamped 19:00.

**How bad: Blocker.** Offline selling is a headline feature of this app. This breaks the daily cash-up (sales land in the wrong day if the reconnect crosses midnight), `report_by_hour` entirely, and `report_daily_trend`. The device already has the correct value and discards it.

Note the silver lining: because the server clock is authoritative, a **wrong phone clock cannot corrupt timestamps** — which is what you asked about. The bug is the opposite of the one you were worried about.

**Covered by a test?** No. No test asserts anything about `created_at` propagation.

**Smallest fix.** Add a `p_created_at timestamptz default null` parameter to `record_sale` and use `coalesce(p_created_at, now())`. Pass `sale.created_at` from `submitSale`. Guard against a wildly wrong device clock by rejecting values in the future or more than ~30 days old, falling back to `now()`:

```sql
case when p_created_at between now() - interval '30 days' and now() + interval '1 hour'
     then p_created_at else now() end
```

That keeps a broken phone clock from inventing sales next year while still honouring the real offline sale time.

---

### B3 — An expired token quarantines real sales instead of retrying

**What happens today.** The error classifier I added treats anything it does not recognise as permanent:

```
src/lib/sales/offlineQueue.ts
export function isTemporaryError(message: string): boolean {
  const msg = message.toLowerCase();
  return msg.includes("network") || msg.includes("timeout") ||
    msg.includes("failed to fetch") || msg.includes("fetch failed") ||
    msg.includes("socket") || msg.includes("502") ||
    msg.includes("503") || msg.includes("504");
}
```

Supabase reports an expired session as `JWT expired`, `Invalid Refresh Token`, or a bare `401`. None of those match, so `isTemporaryError` returns `false`, and `useSaleSync` quarantines on the **first** attempt:

```
if (!temporary || exhausted) { await quarantineSale(sale, message); }
```

The sale is not lost — it moves to the stuck list and the data is intact — but it stops trying, and it only resurfaces if the owner happens to open the Stuck sales screen and press Retry. An auth blip is exactly the kind of thing that resolves itself on the next refresh.

**How bad: Blocker.** It silently parks real revenue. The whole point of the M5 work was that temporary problems keep retrying; auth is temporary and is being classified as permanent. It is also the single cheapest fix on this list.

**Covered by a test?** Partly, and the test encodes the wrong behaviour. `tests/sales/syncCycle.test.ts` explicitly asserts the bug:

```ts
it.each([..., "401 Unauthorized", "403 Forbidden", ...])(
  "classifies '%s' as permanent", (msg) => {
    expect(isTemporaryError(msg)).toBe(false);
  });
```

That assertion needs to flip for 401/403.

**Smallest fix.** Treat auth failures as temporary:

```ts
msg.includes("jwt") || msg.includes("token") ||
msg.includes("401") || msg.includes("403") ||
```

and update the test. The 5-attempt cap still stops an infinite loop if the session is genuinely dead, and at that point quarantine is the right answer.

---

### B4 — Stock can go negative, silently

**What happens today.** There is no constraint:

```
supabase/migrations/20260101000004_products.sql
stock_quantity numeric(12, 3) not null default 0,     -- no CHECK
```

and no guard in the trigger:

```
supabase/migrations/20260101000007_sales.sql:58
update products set stock_quantity = stock_quantity - new.quantity
where id = new.product_id;
```

Selling 10 of something you have 3 of leaves `stock_quantity = -7`. Nothing in the UI warns, and no screen or report lists negative-stock products.

It then propagates into inventory valuation, which multiplies stock by cost with no floor:

```
supabase/migrations/20260101000014_reports.sql:330
coalesce(round(sum(p.stock_quantity * p.current_cost_cents)), 0)::bigint
```

One oversold item can offset the value of real stock and understate the whole inventory.

**How bad: Blocker** — not because selling must be blocked, but because it is *invisible*. For a corner shop, allowing the sale is correct: if the item is physically on the counter, the cashier must be able to ring it up regardless of what the database believes. Blocking the sale would be the wrong fix and would be worse than the bug. What makes this ship-blocking is that there is no signal anywhere that the count has drifted, so it compounds silently until the owner's stock figures are meaningless.

**Covered by a test?** No. `tests/stock/stockFlow.test.ts` covers the arithmetic of purchase/sale/adjustment deltas but never asserts a floor or a negative case.

**Smallest fix.** Keep allowing the sale; make the drift visible. Two cheap pieces:

1. Surface it in the cart — `addProduct` already has `stock_quantity`, so show a warning when `quantity > stock_quantity` rather than refusing.
2. Add negative stock to the existing low-stock screen. `is_low_stock` is `stock_quantity <= low_stock_threshold`, which is already true for negatives, so they show up today — but they are not distinguished from ordinary low stock. Sorting that list by `stock_quantity` ascending puts the oversold ones at the top and is close to free.

Do **not** add `check (stock_quantity >= 0)`: it would make the trigger throw and reject legitimate sales at the counter.

---

## Important

### I1 — Per-line discount allocation does not sum to the sale discount

**What happens today.** A basket discount is split across lines pro-rata, with each line rounded independently, in both the SQL view and its TypeScript mirror:

```
supabase/migrations/20260101000014_reports.sql:38
round(sale_discount_cents * line_total_cents::numeric / sale_lines_total)
```
```
src/lib/reports/math.ts:17
Math.round((saleDiscountCents * lineTotal) / total)
```

Independent rounding means the parts do not add up to the whole. Running the actual allocation:

```
lines=[333,333,334] disc=10  -> alloc=[3,3,3]       sum=9  drift=-1
lines=[100,100,100] disc=10  -> alloc=[3,3,3]       sum=9  drift=-1
lines=[700,700,700] disc=100 -> alloc=[33,33,33]    sum=99 drift=-1
lines=[101,102,103] disc=7   -> alloc=[2,2,2]       sum=6  drift=-1
lines=[1,1,1,1,1,1] disc=5   -> alloc=[1,1,1,1,1,1] sum=6  drift=+1
```

So the answer to *"do line profits sum exactly to sale profit in cents?"* is **no** — it drifts by a centime or two on any discounted multi-line basket, in both directions. The last case over-allocates: six 1-centime lines absorb 6 centimes of a 5-centime discount.

The view's own header comment claims the opposite ("the product tables would not reconcile with the headline profit" — implying this makes them reconcile). They do not reconcile.

**How bad: Important.** Pennies per sale, and it never corrupts a stored total — `sales.total_cents` is computed independently and correctly. But the per-product report will not tie to the headline, which is precisely the kind of thing that makes an owner stop trusting the numbers.

**Covered by a test?** No — and the existing tests pass only because of a lucky choice of fixture. `tests/reports/math.test.ts:26` asserts `allocateSaleDiscount([...], 150) === [41, 109]`, and `41 + 109 = 150` happens to be exact. No test asserts the sum property in general.

**Smallest fix.** Largest-remainder allocation: round every line down, then hand the leftover centimes one at a time to the lines with the biggest fractional parts. Change it in `src/lib/reports/math.ts` and in the view, and add the property test that is missing:

```ts
expect(allocateSaleDiscount(anyLines, anyDiscount).reduce(sum)).toBe(anyDiscount)
```

---

### I2 — Zero-cost products report 100% margin

**What happens today.** `current_cost_cents` is `not null default 0`, so a product that has never been received through a delivery has a cost of exactly 0. The two layers then disagree.

The client refuses to show a number:

```
src/lib/money.ts:45
export function marginPercent(sellingPriceCents, costCents) {
  if (costCents <= 0 || sellingPriceCents <= 0) return null;   // UI shows "—"
```

The SQL does not have that guard — it only guards against zero *revenue*:

```
supabase/migrations/20260101000014_reports.sql:105
then round((t.revenue - c.cogs)::numeric * 100 / t.revenue, 2)
```

With `cogs = 0` that is exactly `100.00`. So the product list shows `—` and the Reports screen shows a 100% margin and full profit for the same product.

A shop that imports its catalogue by CSV without the optional cost column lands here for its entire inventory, and the Reports screen will tell the owner every dirham of revenue is profit.

**How bad: Important.** Not data corruption, but actively misleading on the one screen the owner uses to make decisions.

**Covered by a test?** The client half is: `tests/money/margin.test.ts` pins the `null` behaviour. The SQL half is not covered, and `tests/reports/math.ts`'s `grossMarginPercent` mirrors the *client* guard, so the mirror and the SQL disagree too.

**Smallest fix.** Give the SQL the same guard the client has — return `null` for `margin_percent` when `cogs = 0`, and exclude zero-cost lines from the margin denominator. Then surface the count of zero-cost products somewhere the owner sees it, because the real fix is entering the costs.

---

### I3 — CSV export has no UTF-8 BOM, so Arabic names break in Excel

**What happens today.** Import is fine; export is not. I ran the actual round-trip.

Import handles everything a Moroccan Excel file throws at it:

```
delimiter: ";"                          <- semicolons auto-detected
headers: ["Nom","Prix de vente","Quantite"]
header[0] starts with BOM? false        <- Papa strips the BOM itself
rows: [{"Nom":"Coca 1L","Prix de vente":"12,50",...},
       {"Nom":"عصير",...}]              <- Arabic intact
errors: 0
```

Export does not:

```
unparse has BOM? false
```

`Papa.unparse` emits no BOM, and `saveTextFile` wraps it in a blob that only *declares* the encoding in a MIME type Excel ignores:

```
src/lib/files.ts:26
const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
```

Excel on Windows needs a leading BOM to detect UTF-8. Without it, it falls back to the system code page and every Arabic product name opens as mojibake.

**How bad: Important.** The export is the owner's backup and the way data gets to an accountant. For a trilingual shop with Arabic product names, the export is unreadable in the tool they will actually open it with.

**Covered by a test?** No. `tests/products/csv.test.ts` tests `toCsv` output as a JS string, where the BOM is irrelevant.

**Smallest fix.** Prepend the BOM in `saveTextFile`, which fixes every export path at once:

```ts
const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" });
```

and the same for the native `FileSystem.writeAsStringAsync` branch.

---

### I4 — The cart is lost if Android kills the app

**What happens today.** The in-progress basket is ordinary React state:

```
app/(app)/sell/index.tsx
const [lines, setLines] = useState<CartLine[]>([]);
```

Nothing is written to storage until **after** the cashier confirms payment, at which point `enqueueSale` persists it. Android reclaims backgrounded apps aggressively — a cashier who switches to the calculator or takes a call mid-basket can come back to an empty cart with no indication anything was there.

**How bad: Important.** Recoverable by re-scanning, but at a busy counter with a 30-item basket that is a real incident, and it is invisible until it happens.

**Covered by a test?** No.

**Smallest fix.** Persist `lines` to AsyncStorage on change (debounced) under a single key, restore on mount, and clear it on a completed sale. The offline queue already establishes the pattern; this is the same thing one step earlier in the flow.

---

### I5 — Double-tap on Pay is only guarded by a React re-render

**What happens today.** Each confirmation mints a **new** sale id:

```
app/(app)/sell/index.tsx
const sale = pendingSaleFrom(Crypto.randomUUID(), {...}, lines);
```

So the server-side idempotency (`on conflict (id) do nothing`) does not help: two taps produce two different ids and therefore two legitimate, distinct sales. The only protection is the button's disabled state:

```
src/components/sell/PaymentSheet.tsx:149
disabled={saving || needsCustomer || short}
```

`saving` is set at the top of `handleConfirm`, but React state is asynchronous. Two taps landing in the same frame both read `saving === false` and both fire.

In practice a second tap usually arrives >16ms later, after the re-render, so this is unlikely rather than impossible — but the failure mode is a duplicate sale and double-charged stock, which is bad enough to deserve a real latch.

**How bad: Important.** Low probability, high consequence, trivial fix.

**Covered by a test?** No — and it is not reachable by the current test style, which has no component rendering.

**Smallest fix.** A ref latch that does not depend on a render:

```ts
const submitting = useRef(false);
const handleConfirm = async (...) => {
  if (submitting.current) return;
  submitting.current = true;
  try { /* ... */ } finally { submitting.current = false; }
};
```

---

### I6 — The USB scanner has no duplicate-scan guard

**What happens today.** The camera path debounces repeats:

```
src/components/sell/ContinuousScanner.tsx
const RESCAN_DELAY_MS = 1500;
if (lastScan.current.code === code && now - lastScan.current.at < RESCAN_DELAY_MS) return;
```

The keyboard-wedge path — which is the path on web, and the one a counter with a USB scanner actually uses — has no equivalent. `useKeyboardWedge` fires on every Enter, and `addProduct` increments silently:

```
app/(app)/sell/index.tsx
if (existing >= 0) { next[existing] = { ...next[existing], quantity: next[existing].quantity + 1 }; }
```

A scanner that double-fires, or a cashier who scans the same item twice because the first beep was missed, produces quantity 2 with no visible difference from an intentional second scan. The customer is overcharged and nothing looks wrong.

**How bad: Important.** Silent overcharge at the till is the worst category of error for a shop's reputation, and flaky USB scanners double-firing is common.

**Covered by a test?** No.

**Smallest fix.** Reuse the camera's dedupe window in `useKeyboardWedge` — track the last code and timestamp, ignore an identical code inside ~1000ms. Deliberate double-scans of the same item are slower than that; if you want to be safe, show the quantity change as a flash message so an unintended bump is at least visible.

---

### I7 — Voiding an old sale rewrites already-closed reports

**What happens today.** Voiding is a soft delete, and every report filters voided sales out unconditionally:

```
supabase/migrations/20260101000014_reports.sql:28
where s.voided_at is null
```

Voiding a sale from three weeks ago therefore changes *that week's* reported revenue, COGS and profit retroactively. A report the owner printed or exported at the time will no longer match what the app says today, with nothing to explain the difference. The stock restoration is handled correctly and only once (`if not found then return`), so this is purely a reporting-history issue.

**How bad: Important.** For a single-owner corner shop, "the number just changed" is confusing but survivable. It becomes a real problem the moment those figures are used for tax or for reconciling a cash drawer against a printed Z-report.

**Covered by a test?** No test covers void-vs-report interaction.

**Smallest fix.** Cheapest: record the void in the period it was *made*, not the period of the original sale, by reporting voids as a separate negative line (`voided_at` in range) instead of erasing the original (`created_at` in range). That keeps history immutable. If that is too big a change for now, at minimum show voided totals alongside net on the Reports screen so the owner can see why a past figure moved.

---

### I8 — `1.234` in a supplier CSV imports as 1.23 DH

**What happens today.** `parseMoneyToCents` resolves the separator by position — whichever of `,` or `.` appears last is treated as the decimal point:

```
src/lib/money.ts:60
if (lastComma > lastDot)      { /* "12,50" -> 12.50  ✓ */ }
else if (lastDot > lastComma) { normalized = cleaned.replace(/,/g, ""); }
```

That rule is right for `12,50` and `1,234.56`. It is wrong for `1.234` written with a dot as a *thousands* separator — a European convention a Moroccan supplier may well use. The string parses as `1.234`, rounds to `123`, and a 1 234 DH buying price is imported as **1.23 DH**: a 1000× error, in the direction that makes everything look wildly profitable.

**How bad: Important.** It lands in `cost`, so it corrupts weighted-average cost and every margin derived from it, and it is invisible — 1.23 DH is a plausible-looking number.

**Covered by a test?** Yes — but the test *documents* the behaviour rather than flagging it. `tests/money/money.test.ts` pins `parseMoneyToCents("1.234") === 123` with a comment calling it ambiguous. The ambiguity is acknowledged and then shipped into the import path.

**Smallest fix.** The import screen already previews rows before committing. Flag ambiguity there rather than guessing: when a value matches `^\d{1,3}[.,]\d{3}$` (exactly one separator followed by exactly three digits), it is genuinely undecidable — show the row as a warning with both interpretations and make the user pick. A global "decimal separator" toggle on the import screen, defaulting to comma for a French-first app, would also work and is less code.

---

### I9 — A stale offline cache can sell a deactivated product

**What happens today.** The cache only stores active products and filters on read:

```
src/lib/products/offlineCache.ts
.eq("active", true)
...
return products.find((p) => p.barcode === barcode && p.active) ?? null;
```

But `active` is the value **as of the last refresh**. A product deactivated while the device is offline stays sellable from the cache until connectivity returns. The price is likewise frozen at the last refresh, so a price change made by the owner is not reflected — which is the documented trade-off and is why the banner shows the cache age.

**How bad: Important, bounded.** The offline banner tells the cashier the data is stale, and selling a discontinued item is a far smaller problem than being unable to sell at all. Worth knowing, not worth blocking launch.

**Covered by a test?** The filter is: `tests/products/offlineCache.test.ts` asserts inactive products are excluded. Staleness is not tested, and cannot be meaningfully unit-tested.

**Smallest fix.** Show the cache age more prominently once it exceeds a threshold (say 24h) and refresh on app foreground as well as on reconnect, so the stale window is as short as the device's connectivity allows.

---

## Minor

### M1 — `profitCents` is dead code that disagrees with the SQL

`src/lib/money.ts:40` exports `profitCents`, and nothing imports it:

```
$ grep -rn "profitCents" src/ app/
src/lib/money.ts:40:export function profitCents(...)
```

It rounds at a different point than the SQL does — client `round((price - cost) * qty)` versus SQL `(round(qty*price) - discount) - round(cost*qty)`. Sweeping the realistic input space found **151 disagreeing cases**, all at very small fractional quantities:

```
q=0.002 p=250 c=1   -> client 0, sql 1  (diff -1)
q=0.002 p=251 c=2   -> client 0, sql 1  (diff -1)
```

2 grams is not a realistic sale, so there is no live bug — the function is unreachable. It is a trap: the next person to need per-line profit will reach for the helper named `profitCents` and get numbers that disagree with every report. Delete it, or reimplement it to match the SQL and add the test.

### M2 — `sale_line_economics` has no `security_barrier`

Migration 15 added `security_barrier = true` to `sale_items_cashier_view` and `stock_adjustments_cashier_view` but not to `sale_line_economics`, which also protects itself with a row filter (`where public.is_owner()`). Without the barrier, Postgres is permitted to evaluate a caller's predicate before the filter.

There is no reachable exploit today: the attack needs a user-defined function or operator to use as the leaky predicate, and the `authenticated` role cannot create one. PostgREST only composes built-in operators. So this is defence-in-depth, not a live hole — but it is a one-word change and it makes the three protected views consistent:

```sql
create or replace view sale_line_economics with (security_barrier = true) as ...
```

### M3 — Receipts render Arabic but stay left-aligned

`tablesToHtml` sets the charset correctly, so Arabic text appears:

```html
<head><meta charset="utf-8" />
```

But there is no `dir` attribute and the alignment is hard-coded LTR:

```css
th { text-align: left; ... }
```

An Arabic receipt renders readable text in a left-aligned table. The font stack (`-apple-system, Helvetica, Arial`) resolves to something Arabic-capable on iOS and on most Android WebViews, so this is alignment only, not missing glyphs. Fix by setting `dir="rtl"` on `<html>` when the active language is `ar` and using `text-align: start` instead of `left`.

### M4 — Duplicate product names are allowed with no warning

`barcode` is uniquely indexed (partial, `where barcode is not null`, so multiple barcode-less products are correctly allowed). `name` has no uniqueness constraint and the CSV importer checks barcodes for duplicates but never names. Importing a supplier list twice creates two of everything with no complaint, and search then shows two identical rows with no way to tell them apart. Warn on exact-name collision at import and in the product form.

### M5 — A zero-price product produces a negative margin

`selling_price_cents >= 0` permits 0, which is legitimate for a giveaway. Margin then becomes `(0 - cost) / 0` — the client guard returns `null` (`sellingPriceCents <= 0`), but the SQL's `case when revenue > 0` means the line contributes cost with no revenue, dragging the aggregate margin negative with no explanation. Harmless unless free items are actually used; worth excluding zero-price lines from margin aggregates if they are.

---

## What is already solid

Worth stating plainly, because this is where a POS usually goes wrong and this one does not:

**Cashiers genuinely cannot read cost, weighted-average cost, or profit** — not merely hidden in the UI, but blocked at the database. I checked every read path:

| Path | Guard |
|---|---|
| `products` (has `current_cost_cents`) | `create policy "owner reads products" ... using (public.is_owner())` — no cashier SELECT policy at all |
| `sale_items` (has `unit_cost_cents`) | `create policy "owner reads sale items" ... using (public.is_owner())` |
| `purchase_items` (has `unit_cost_cents`) | `create policy "owner reads purchase items" ... using (public.is_owner())` |
| `cost_history` | `create policy "owner reads cost history" ... using (public.is_owner())` |
| `stock_adjustments` (cost column added in m13) | old cashier policy explicitly `drop`ped, replaced with owner-only |
| `products_cashier_view` | cost columns simply absent from the projection |
| `sale_items_cashier_view` | cost absent + `security_barrier = true` |
| `stock_adjustments_cashier_view` | cost absent + `security_barrier = true` |
| `sale_line_economics` | `where public.is_owner()` → cashier gets zero rows |
| `purchase_summaries` / `_monthly_totals` / `_supplier_totals` | each ends `where public.is_owner()` |
| all 7 `report_*` functions | each opens `if not public.is_owner() then raise exception 'Reports are owner only'` |
| `expiring_batches`, `product_sales_30d`, `customer_balances` | shared with cashiers deliberately — verified to contain no cost column |

`is_owner()` itself is correctly hardened — `security definer`, `stable`, `set search_path = public` — so it cannot be subverted by search-path games.

**Cashiers also cannot:**
- **change prices** — no UPDATE policy on `products`; `bulk_adjust_selling_price` and `batch_update_selling_prices` are both `security invoker`, so RLS applies and a cashier's call updates zero rows (it no-ops silently rather than erroring, which is worth knowing)
- **void sales** — `void_sale` is `security definer` but opens with `if not public.is_owner() then raise exception`
- **delete products** — no DELETE policy exists for any role but owner
- **promote themselves to owner** — `trg_prevent_role_self_escalation` blocks a role change from any non-owner API caller, while deliberately allowing it for migrations where `auth.uid()` is null

**Two devices selling the last unit at the same time is safe.** `update products set stock_quantity = stock_quantity - new.quantity` is a single statement, so Postgres takes a row lock and the second transaction re-reads the updated value. The decrements serialise; there is no lost update. Both sales succeed and stock goes to −1, which is the correct outcome — you cannot un-sell goods that left the shop. (The −1 being invisible is [B4](#b4--stock-can-go-negative-silently), not a concurrency bug.)

**Re-syncing a queued sale cannot double-sell.** `record_sale` is idempotent on the client-generated primary key via `on conflict (id) do nothing`, and returns early (`if not found then return`) before touching `sale_items`, so a retry adds no lines and moves no stock.

**The client's total is not trusted.** `record_sale` recomputes the basket total server-side from the line inputs and clamps it (`greatest(0, ...)`), so a tampered or buggy client cannot record a sale at the wrong price. A sale-level discount larger than the basket is clamped at both layers.

**`unit_cost_cents` is always stamped server-side** by `trg_sale_items_before_insert`, so a cashier who cannot read cost never has to supply it — which is what makes the column-level isolation workable at all.

**CSV import handles real Moroccan Excel files.** Verified by running it: semicolon delimiters auto-detected, UTF-8 BOM stripped by Papa, Arabic preserved, and `12,50` correctly parsed to 1250 centimes. The one gap is the genuinely ambiguous `1.234` form ([I8](#i8--1234-in-a-supplier-csv-imports-as-123-dh)).

**Negative and zero quantities are rejected** at both layers — `check (quantity > 0)` on `sale_items`, and `parseMoneyToCents` returns `null` for negatives so `validLines` filters them out client-side.

**A cashier can keep selling with an expired token.** Ringing up a sale only writes to AsyncStorage, so authentication state never blocks the till. Only the queue drain is affected ([B3](#b3--an-expired-token-quarantines-real-sales-instead-of-retrying)).

**80 queued sales syncing at once** is sequential and safe but not fast: `useSaleSync` awaits each `submitSale` in turn, so 80 sales is 80 round trips — roughly 30–60s on a weak connection. Nothing breaks (progress is durable; each success is removed from the queue before the next is attempted, so an interruption resumes cleanly) and partial failure is handled correctly after the M5 work. It is slow, not broken; batching would be an optimisation, not a fix.

---

## Test coverage gaps

The suite is 218 passing tests, but all of them are pure-function unit tests. Three categories are entirely untested:

1. **Nothing touches the database.** Every trigger, RLS policy, constraint and RPC — i.e. all four blockers except B3 — is unverified by CI. [B1](#b1--a-line-discount-above-the-line-price-rejects-the-whole-sale) in particular is a client/server *disagreement*, which unit tests on either side can never catch.
2. **Nothing renders a component.** [I5](#i5--double-tap-on-pay-is-only-guarded-by-a-react-re-render) (double-tap) and [I6](#i6--the-usb-scanner-has-no-duplicate-scan-guard) (double-scan) are both interaction bugs with no test that could express them.
3. **One existing test asserts a bug as correct.** `tests/sales/syncCycle.test.ts` pins `isTemporaryError("401 Unauthorized") === false`, which is [B3](#b3--an-expired-token-quarantines-real-sales-instead-of-retrying). Fixing the bug requires changing that assertion — worth noting so it is not mistaken for a regression.

I added one file, `tests/security/cashierIsolation.test.ts`, which attempts every cost-bearing read path with a real cashier token and asserts each one fails or returns no cost. It is the proof you asked for, and it is the one thing here that cannot be established by reading policies alone — reading them tells you what *should* happen, and only running them against a live project tells you what does. It skips cleanly when credentials are absent so it never breaks CI; see the header comment in that file for the four environment variables it needs and how to create the cashier fixture.

---

## Suggested order

1. **[B3](#b3--an-expired-token-quarantines-real-sales-instead-of-retrying)** — two lines plus a test assertion flip. Do it first; it is the cheapest and it protects real revenue.
2. **[B1](#b1--a-line-discount-above-the-line-price-rejects-the-whole-sale)** — one-line client clamp, plus the matching server clamp.
3. **[B2](#b2--offline-sales-are-timestamped-when-they-sync-not-when-they-happened)** — one migration adding a parameter, one call site. Needed before the first full offline day, because the data it loses cannot be reconstructed afterwards.
4. **[B4](#b4--stock-can-go-negative-silently)** — make it visible; resist the urge to block the sale.
5. Run `tests/security/cashierIsolation.test.ts` against the real project once, so the permission model is proven and not just read.
6. **[I1](#i1--per-line-discount-allocation-does-not-sum-to-the-sale-discount)**–**[I3](#i3--csv-export-has-no-utf-8-bom-so-arabic-names-break-in-excel)** before the owner starts relying on reports and exports.
7. The rest as convenient.
