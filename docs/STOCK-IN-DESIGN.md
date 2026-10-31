# Stock In: assessment and purchase-history design

Status: design only, no app code. Decisions recorded 2026-10-31 (see Decisions). Written 2026-10-31 against `main` at `83beaaa`
(migrations 1–21). `count.tsx` is out of scope: Codex T02 owns it.

Reproductions were run live against the **local** Supabase stack, never
production. The local DB also had T02's uncommitted migrations 22–23 applied;
they don't touch any path reproduced here. Every test row was named `ZZ-REPRO`
and deleted afterwards. The local DB was back to its starting counts (201
products, 3 purchases, 0 adjustments).

Severity scale used throughout:

- **Blocker**: wrong stock, wrong cost or lost money with ordinary use. Fix before real deliveries are entered.
- **Important**: wrong numbers or a dead end in a common situation, with a manual workaround.
- **Minor**: cosmetic, rare, or only reachable through the API.

---

## Part 1: what exists today

### 1.1 Screens

| Screen | File | Who | What it does |
|---|---|---|---|
| Receive delivery | `stock-in/index.tsx` | Owner only (cashier gets "blocked" text) | Pick supplier (or none, or add one inline). Add products via search. Per line: quantity, unit cost (prefilled from last price paid, else WAC), optional expiry `YYYY-MM-DD`, optional new selling price (suggested when cost moved >10 %). Then notes, delivery total, Save. Also shows the tool links and the negative-stock alert. |
| Purchase history | `stock-in/history.tsx` | Owner (views are `is_owner()`-guarded) | Three tabs. Deliveries: last 25, supplier, date, line count, notes, total; no paging, no detail. Months: last 12 monthly totals. Suppliers: all-time total per supplier. Read-only: no drill-down, filter or export. |
| Adjust | `stock-in/adjust.tsx` | Owner (unreachable for cashier, see 1.3) | Pick product and reason (damaged / expired / theft / count correction), enter quantity and note. Losses are forced negative. Shows the stock preview and, for the owner, the loss value. Lists the last 50 adjustments. |
| Low stock | `stock-in/low-stock.tsx` | Owner | Products under threshold, 30-day sales velocity, suggested reorder quantity, days left, CSV export. |
| Expiring | `stock-in/expiring.tsx` | Owner | Delivery lines with an expiry inside 7 / 30 / 90 days, showing "delivered N · M in stock" and days left. |
| Negative stock | `stock-in/negative-stock.tsx` | Owner | Products below zero, how long they've been negative, and value. Linked from the receive screen only when the count is above 0. |
| Count | `stock-in/count.tsx` | — | Out of scope (T02). |
| Product price history | `products/history/[id].tsx` | Owner | Purchase cost over time per product (last 100 lines), chart plus list. This is the per-product half of Part 3, and it already exists. |

### 1.2 Data path

- `createPurchase()` makes **two separate HTTP calls**: insert `purchases`, then insert `purchase_items`.
- The trigger `apply_purchase_item` (per line, `FOR UPDATE` on the product) adds stock, recomputes WAC and writes `cost_history`.
- Selling-price changes go through `batch_update_selling_prices`, a **third** call made after the purchase has committed.
- `purchase_date` always defaults to `now()`; nothing can set it.
- `purchase_items` has insert and select policies only: no update, no delete.
- The owner can delete a `purchases` row. Its items cascade away, but **no trigger reverses stock or WAC** (see 2.1).

### 1.3 Code vs CLAUDE.md mismatch (resolved)

CLAUDE.md used to say the cashier does "sales and stock receiving". The code blocks the cashier from the whole Stock In tab: the tab is visible, but `index.tsx` returns the "blocked" text before rendering the tool links.

**Decision (Q1):** only the owner receives deliveries. CLAUDE.md is corrected in the same commit as this update. Expiring and Low stock stay owner-only for now as well: they live behind the blocked screen, and opening them to cashiers is a separate, later change.

### 1.4 Audit findings: status on `main`

All five are **still open on main**. Each was reproduced live with the exact request sequence the app makes.

| ID | Still open? | Live reproduction (local) |
|---|---|---|
| **C03** Retry after a price-update failure receives stock twice | **Open. Blocker.** | Save with a selling-price update that fails → error shown, form kept → Save again → **20 units, 2 purchases** for one 10-unit delivery. The same happens if the response is lost after the items commit. |
| **C07** Header and items not atomic; invalid dates | **Open. Important.** | The screen regex accepts `2026-02-31`. Save → the header commits, the items fail with `date/time field value out of range` → fix the date and retry → stock correct (5), but **2 headers, 1 empty**. Also `31/03/2026` (the natural Moroccan format) silently becomes "no expiry". |
| **C10** CSV opening stock partial import | **Open. Important.** | 2 rows, one opening quantity overflows `numeric(12,3)` → result `{inserted:2, openingLines:2, errors:[…]}` but **0 opening lines saved** and stock 0 for both. Re-import after fixing the row → `duplicate key … products_barcode_key`, nothing inserted, plus **another empty "opening stock" header**. There's no way to add opening stock to those products except a manual delivery. |
| **C11** Adjustments not idempotent | **Open on main. Fix in progress in T02.** | `adjust.tsx` → `createAdjustment` twice with the same intent (response lost) → **2 rows, stock 20 → 14** instead of 17. T02's uncommitted work adds `record_stock_adjustment(p_operation_id, …)` (migration 22), but only the count screen opts in; **`adjust.tsx` would still use the old path.** C11's customer-payment half (`sell/credit.tsx`) is outside Stock In and also still open. |
| **U11** Expiry tracks delivered quantity, not remaining | **Confirmed. Important.** | Batch A: 10 units expiring in 5 days. Sell all 10. Batch B: 10 units expiring in 120 days. "Expiring in 7 days" still lists **batch A: delivered 10 · 10 in stock, 5 days left**. The 10 on the shelf are batch B. The owner would pull good stock. |

Raw output of every reproduction is in Appendix A.

---

## Part 2: edge cases

Each entry: today's behaviour → severity → smallest fix. "Receive RPC" means the transactional `receive_delivery` function designed in 3.4, which is the fix for C03/C07.

### 2.1 Fixing or cancelling a wrong delivery
- **Today:** there is no UI.
  - The API refuses to update `purchase_items` (0 rows, no policy).
  - Deleting the purchase is allowed. Live: received 10 @ 6.00, then a typo of 100 @ 7.00 → stock 110, WAC 6.91 → deleted the typo purchase → **stock still 110, WAC still 6.91**. The items are gone, and `cost_history` keeps an orphan row with a null link.
  - So today the only "fix" is an adjustment (−100, reason count correction). That fixes stock but **leaves WAC permanently wrong**, and leaves the delivery and expense in history at the wrong value.
- **Severity:** **Blocker.** Typos in quantity or cost will happen in week one.
- **Smallest fix:** owner-only `void_purchase(purchase_id, reason)` RPC, mirroring `void_sale`.
  - Revoke `DELETE` on purchases from `authenticated` so the silent path is closed.
  - **Decision (Q2):** correction = void + re-enter, with "Duplicate as new delivery" prefilled from the voided one. Never edit in place: edits make the stock/WAC audit trail unreadable.

#### 2.1.1 What voiding does, exactly

Voiding a delivery is one transaction, applied line by line in the order the lines were received.

1. **Past sales are not touched.** Every `sale_items` row keeps the `unit_cost_cents` stamped at the moment of sale. Profit already reported for those days stays as it was. Voiding corrects the future, not the past.
2. **Stock** goes down by the voided quantity, even if some of those units were already sold: `S' = S − q`. If that goes below zero, the product appears on the negative-stock screen until the correct delivery is re-entered.
3. **Average cost going forward** is recomputed by taking the voided line's money out of the stock value:

   ```
   S  = stock now (before the void)        W  = average cost now
   q  = voided line quantity                c  = voided line unit cost
   S' = S − q

   if S' > 0 and S·W − q·c > 0:
       W' = round( (S·W − q·c) / S' )
   else:
       W' = W_before   -- the average cost recorded in cost_history just before
                       -- the voided line was received
   ```

   A `cost_history` row with source `purchase_void` records `W'`.

4. **The purchase row stays**, marked `voided_at / voided_by / void_reason`. It drops out of purchase totals, supplier balances and the expiring list, and shows struck-through in history.
5. **The void is idempotent.** Voiding an already-voided delivery returns without doing anything.

**Why this formula.** It keeps *money paid = cost of goods already sold + value of stock left*, up to rounding. If some units were sold at an inflated average, the stock left ends up slightly cheaper by the same total, so the month's profit evens out over the next sales. The fallback applies when the formula can't produce a sensible number: no stock left, or the sold units carried less of the wrong cost than the formula removes. There it restores the pre-delivery cost. That breaks the money identity, by at most the units sold in between × the cost error. The void confirmation dialog shows the before → after stock and average cost so the owner sees it.

**Worked example A: cost typo, some units sold (formula path)**

| Step | Stock | Avg cost | Note |
|---|---|---|---|
| Start | 20 | 5.00 | |
| Delivery: 24 @ **6.00** (should be 5.00) | 44 | 5.55 | (20·500 + 24·600) / 44 = 554.5 → 555 |
| Sell 4 | 40 | 5.55 | each sale stamped 5.55; these 4 sales **keep** 5.55 |
| Void the delivery | 16 | 4.88 | (40·555 − 24·600) / 16 = 7800 / 16 = 487.5 → 488 |
| Re-enter 24 @ 5.00 | 40 | 4.95 | (16·488 + 24·500) / 40 = 495.2 → 495 |

Check: money actually paid 20·5.00 + 24·5.00 = 220.00 DH. Cost of the 4 sales 4·5.55 = 22.20, plus stock left 40·4.95 = 198.00, makes 220.20 DH. The 0.20 difference is rounding. The 0.55/unit overcost on the 4 past sales is offset by the remaining 40 units being valued 0.05 lower.

**Worked example B: quantity typo, stock goes negative (fallback path)**

| Step | Stock | Avg cost | Note |
|---|---|---|---|
| Start | 10 | 6.00 | |
| Delivery: **100** @ 7.00 (should be 10) | 110 | 6.91 | (10·600 + 100·700) / 110 = 690.9 → 691 |
| Sell 15 | 95 | 6.91 | sales keep 6.91 |
| Void the delivery | **−5** | 6.00 | S' = −5 ≤ 0 → fallback to the cost before the delivery |
| Re-enter 10 @ 7.00 | 5 | 7.00 | stock was ≤ 0, so the existing trigger takes the new cost |

The 5 units on the shelf match physical stock: 10 + 10 − 15. Their value of 7.00 against a "true" average of 6.50 is the fallback's error: 2.50 DH in total, shown in the confirmation dialog.

### 2.2 Returns to supplier (damaged / expired)
- **Today:** only an adjustment with reason `damaged` or `expired`. Stock goes down, the loss is valued at WAC, and the supplier is never credited. Nothing records that the supplier owes a refund or replacement.
- **Severity:** Important.
- **Smallest fix:** new adjustment reason `supplier_return`, plus an optional `supplier_id` and `credit_cents` on the adjustment. The credit feeds the supplier balance (2.3). WAC is unchanged: a return at cost removes units at the average cost. If the supplier refunds a different amount, the difference is a loss or gain on the return and is not pushed into WAC.

### 2.3 Money owed to suppliers
- **Today:** not modelled. There is no paid/unpaid status, payment or balance. The Suppliers tab shows lifetime purchases only.
- **Severity:** Important. Corner stores routinely take goods on credit from distributors, and this is the number the owner most wants.
- **Smallest fix:** a `supplier_payments` table (supplier, amount, method, date, note, operation id) plus a `supplier_balances` view: deliveries − returns credited − payments. Each delivery gets a derived status of paid / partly paid / unpaid. The simple model (Q4) allocates payments to the oldest unpaid delivery first, for display only, so no allocation table is needed. "Paid on delivery" is a checkbox on receive that creates the payment in the same RPC.

### 2.4 Free / bonus units
- **Today:** entering the bonus as a line at cost 0 is accepted. Live: 10 @ 6.00 + 2 free @ 0 → **WAC 5.00**. That is the economically correct per-unit cost: 60 DH for 12 units. Entering the bonus "inside" the paid line (qty 12 @ 5.00) gives the same WAC.
- **Problems:**
  - "Last price paid" for the next delivery will show **0.00** if the free line was entered last.
  - The price-change alert fires as a 100 % drop.
  - The suggested selling price collapses.
- **Severity:** Important.
- **Smallest fix:** a `free_quantity` column on the line, alongside the paid quantity. Stock += qty + free; WAC uses paid cost spread over all units. The line total shows the paid amount only.
- **Decision:** free units are **excluded from "last price paid"** and from the price-change alert. Both use the paid unit cost (`line_total_cents / paid quantity`) of the most recent non-voided line with a paid quantity above 0. Until R6 adds `free_quantity`, lines entered at cost 0 are skipped for the same reason.

### 2.5 Cartons vs units (buy 24, sell 1)
- **Today:** no packaging concept. The owner must type 24 and the per-unit cost.
- **Severity:** Important. This is the most common receiving action in a convenience store, and per-unit cost typing is where the rounding errors (2.8) come from.
- **Smallest fix:** a `pack_size` column on products (default 1), plus on the receive line a toggle "cartons × pack_size" and a "carton price" field.
  - Store the line in **units** (stock and WAC stay unit-based, nothing else changes) plus `packs` and `pack_cost_cents` as entered, for the invoice view.
  - A carton barcode (`pack_barcode`) is a later nice-to-have.

### 2.6 Invoice-level supplier discount
- **Today:** not possible. The owner would have to recompute each line's cost by hand.
- **Severity:** Minor to Important. Common with distributors ("2 % remise").
- **Smallest fix:** a `discount_cents` column on the purchase header. Allocate it across lines **by line value, largest remainder**, the same algorithm as sale discounts (migration 18), and store the result per line as `allocated_discount_cents`. The trigger uses the **net** unit cost for WAC. The invoice view shows gross, discount and net.

### 2.7 Same product twice in one delivery
- **Today:** the UI prevents it (`excludeIds`). The API accepts two lines for the same product at different costs. Both are applied sequentially, so the WAC is still correct.
- **Severity:** Minor.
- **Fix:** keep the UI rule. The receive RPC merges lines for the same product **only** when the cost is equal, otherwise it keeps both. Two costs can legitimately happen: a promo batch and a normal batch.

### 2.8 Cost 0, very large quantities, carton rounding
- **Cost 0:** allowed by `check (unit_cost_cents >= 0)` and needed for bonus units. Severity Minor once 2.4 exists. Until then, show a warning "Coût 0 : unités gratuites ?" on the line.
- **Very large quantity:** `numeric(12,3)` caps at 999 999 999.999. Live: 1e9 → raw `numeric field overflow` shown to the owner. Severity Minor. Fix: client-side cap with a readable message, plus a sanity confirm above e.g. 10 000 units per line ("vous avez tapé 24000 — confirmer ?").
- **Carton rounding:** 100 DH / 24 → 4.1667 → stored **417** centimes → line total **100.08 DH** (live: 10008). That's 8 centimes over the invoice on one line, and it compounds across a month. Severity Important (supplier balance won't match the invoice).
  - **Decision:** the line total the owner types is the source of truth. **100.00 DH stays 100.00 DH**: delivery totals, monthly totals, supplier balances and exports all sum `line_total_cents` exactly as entered.
  - The unit cost is derived (`unit_cost_exact = line_total / units`, `numeric(14,4)`) and only used for WAC and for display ("≈ 4.17 / unit").
  - When the owner types a unit cost instead of a total, the line total is `lineTotalCents(qty, unit cost)` and *that* is stored. Either way, exactly one number is typed and stored, and the other is derived.
- **Rounding mismatch (Minor):** `purchase_summaries` totals `round(sum(qty·cost))` per purchase, while the screen rounds per line (`lineTotalCents`). They can differ by a centime on fractional kg lines. Using a stored `line_total_cents` everywhere removes the mismatch.

### 2.9 Delivery date vs entry date
- **Today:** `purchase_date = now()`. A delivery entered three days later is dated today in history, in monthly totals, and in `cost_history.effective_at`. A month-end delivery entered on the 2nd lands in the wrong month.
- **Severity:** Important.
- **Smallest fix:** a "Date de livraison" field on receive (default today, no future dates, up to 60 days back) stored in `purchase_date`, while `created_at` stays the entry time. Report both in the delivery detail. WAC is still applied **at entry time**. Back-dating a delivery does not rewrite sale costs already stamped, which is correct: those sales were sold at the WAC known then. The doc should say this explicitly so nobody "fixes" it.

### 2.10 Who may receive stock
- **Today:**
  - The UI is owner-only.
  - RLS lets a cashier **insert an empty purchase header** (live: accepted when no row is returned), but not items: the items policy's `exists(select … from purchases)` runs under the cashier's RLS and can't see the header.
  - So stock and cost are safe from cashiers, but a cashier can create empty "deliveries" that pollute purchase counts. That part is Minor.
- **Decision (Q1): only the owner receives deliveries for now.** R1 enforces it in the database: the new `receive_delivery` RPC refuses non-owners, and the direct-insert policies on `purchases` / `purchase_items` become owner-only, which closes the empty-header hole. The two-step design below stays on file for later.
- **Later option:** two-step receiving.
  1. **Cashier** records a *pending delivery*: supplier, products, quantities, expiry and invoice photo. **No cost fields at all**, and stock increases immediately so it can be sold. It's a `purchases` row with `status = 'pending_cost'`, and its lines have `unit_cost_cents null`.
  2. **Owner** opens "À valoriser" (to price), enters the costs, and confirms. WAC is computed then.
- **WAC between the two steps:** units received while cost is pending are valued at the current WAC for sales in between (`sale_items.unit_cost_cents` stamped as today). On confirm, the WAC formula uses stock-on-hand at confirm time. It's the same approximation the app already makes for negative stock. It's documented, and acceptable for a corner store.
- Not scheduled. Revisit only if the owner is regularly away when deliveries arrive.

### 2.11 Receiving while offline
- **Today:** Save fails with a network error. The draft lives only in React state, so leaving the screen loses it.
- **Severity:** Important for a 30-line delivery, Minor for 3 lines.
- **Smallest fix:**
  - Phase 1: persist the **draft** to AsyncStorage on every change, keyed by user, and restore it on reopen. Allow Save only when online.
  - Phase 2: queue the receive RPC with its `operation_id`, the same pattern as the offline sale queue, idempotent by design.
  - Don't queue before the receive RPC exists: queuing today's two-call flow would make C03/C07 worse.

### 2.12 Invoice number and invoice photo
- **Today:** neither exists; only free-text notes.
- **Severity:** Important. The owner needs to match the supplier's statement, and the photo is the only proof in a dispute.
- **Smallest fix:**
  - `invoice_number text` on the header, with a unique index per supplier excluding voided purchases. That index also blocks the classic double-entry of the same invoice: a friendly "Facture déjà saisie le …" error.
  - `invoice_photo_path text` pointing to a private Supabase Storage bucket `invoices/`.
    - Owner can read; the uploader can write.
    - Taken with the camera already in the app, compressed to ~1600 px JPEG.
    - The upload happens after the delivery commits and is retryable on its own, so a failed upload never blocks or duplicates the delivery.

### 2.13 Other findings from the read-through
- **StockInLine and ProductSearchPicker have hardcoded English:** "stock", "sells at", "Last paid", "no barcode". The `ADJUSTMENT_REASONS` labels are also English. Severity Minor; fix in PR R2.
- **Negative-stock value:** `negative-stock.tsx` computes `stock_quantity * current_cost_cents` without `Math.round`. With fractional kg it gives a float centime value. It's the CLAUDE.md money rule; use `lineTotalCents`. Severity Minor.
- **Expiry input:** a free-text `YYYY-MM-DD` field on a touch tablet. Replace it with a date picker (day / month / year steppers, no keyboard), which also removes the invalid-date class of C07.

---

## Part 3: purchase history design

### 3.1 Screens (owner only)

Stock In → **Achats** (Purchases) replaces today's `history.tsx`. Same three entry points, each with drill-down.

**A. Deliveries list** (default tab)
- Filter bar, sticky at the top: supplier (chips + search), date range (presets: this month, last month, 30 days, custom), product (search; shows deliveries containing it), status (all / unpaid / partly paid / paid / voided).
- Each row: date (delivery date), supplier, invoice number, line count, total, payment status badge, camera icon if a photo exists, and "voided" struck through.
- Footer: count and total of the filtered set.
- Paged at 50, with a stable sort (`purchase_date desc, id`).
- Tap → **delivery detail**.

**B. Delivery detail**
- **Header:** supplier, invoice number, delivery date, entered at (+ who received it), notes, photo thumbnail (tap = full screen).
- **Lines:** product, quantity (+ free units, + "2 cartons × 24"), unit cost, line total, expiry.
- **Footer:** gross, invoice discount, net, paid, remaining.
- **Actions:**
  - Record payment.
  - Add/replace photo.
  - **Void delivery** (reason required, confirm dialog stating the stock and WAC effect).
  - Duplicate as new delivery.
  - Export this invoice (PDF).
- **Voided deliveries:** read-only with a banner showing who and when.

**C. Per supplier** (tab)
- **List:** supplier, balance owed (largest first), deliveries this month, last delivery date.
- **Supplier page:**
  - Header balance and "Record payment".
  - Month-by-month table (purchases, returns, payments, balance at month end).
  - Below it: that supplier's deliveries (list A pre-filtered) and payments.
  - Phone number tap-to-call.

**D. Per month** (tab): today's monthly totals, each month tappable → list A filtered to that month. Purchases, payments made and returns are shown per month.

**E. Per product:** keep `products/history/[id].tsx`. Add:
- the supplier per point,
- the WAC line from `cost_history` next to the purchase-cost points, so the owner sees what was paid against what the product is valued at,
- a link from each point to its delivery detail.
It's also reachable from the delivery detail by tapping a line.

### 3.2 Export
- **CSV:** filtered deliveries (one row per **line**, with header fields repeated, so it pivots in Excel). The supplier statement is also available (deliveries, returns and payments with a running balance).
  - Reuse `exportTablesAsCsv`.
  - Escape formula-leading cells (`= + - @`) as audit U09 requires. That needs a shared `csvCell()` helper, tested.
- **PDF:** delivery invoice, supplier statement, monthly summary. Reuse `exportTablesAsPdf`.
  - It currently hardcodes left alignment (U12). Add `dir="rtl"` and right alignment when the language is Arabic, and test a rendered Arabic PDF on device.
- Exports are owner-only. They run client-side from owner-only views, so no new server surface is needed.

### 3.3 Owner-only, RTL, FR/EN/AR
- **Server:** every new view carries `where public.is_owner()`, the same pattern as `purchase_summaries`. `supplier_payments` RLS is owner-only. The pending-delivery path (2.10) exposes a `purchases_cashier_view` without money columns, filtered to `created_by = auth.uid()`.
- **Live suite:** extend `cashierIsolation` with the new tables, views and `COST_COLUMNS` (`line_total_cents`, `allocated_discount_cents`, `unit_cost_exact`, `pack_cost_cents`, `credit_cents`, payment amounts).
- **i18n:** all strings in `fr.ts` first, then `en.ts` and `ar.ts` (TypeScript-enforced). Arabic plural forms for "N livraisons" and "N lignes" use all six CLDR categories.
- **RTL:**
  - Money keeps LTR digits inside RTL rows (`isolateBidi` around amounts and product names, as on Sell).
  - Tables mirror column order.
  - Chips scroll from the right.
- **Dates:** locale-formatted day-month-year, never raw ISO, with the store timezone `Africa/Casablanca` from `store_settings`.

### 3.4 Data model (additive migrations only)

Numbering starts **after T02**. T02 holds 22–23 locally and uncommitted, so these start at **024**. Renumber if T02 lands differently. No existing migration is edited.

**024 `receive_delivery` RPC (fixes C03 and C07)**
```sql
alter table purchases add column operation_id uuid unique;   -- client-generated, retained across retries
-- receive_delivery(p_operation_id uuid, p_supplier_id uuid, p_delivery_date date,
--                  p_notes text, p_lines jsonb, p_price_updates jsonb) returns uuid
--   one transaction: header + items (+ selling prices) ; triggers unchanged
--   on conflict (operation_id): return the existing purchase id if the payload hash matches,
--   raise 'operation reused with different payload' otherwise
--   validates: caller is owner, lines non-empty, qty > 0 and < 1e6, cost >= 0, expiry a real date,
--   delivery date not in the future and <= 60 days back
alter table purchases add column payload_hash text;
-- direct-insert policies become owner-only (Q1); a full revoke waits for R4,
-- because the CSV import still inserts directly until import_opening_stock exists
```
- Selling-price updates move **inside** the same transaction, so "price failed after stock committed" can no longer happen.
- The CSV import (C10) gets its own `import_opening_stock(p_operation_id, p_rows jsonb)` built on the same RPC: per-row result, nothing half-applied, safe to re-run.

**025 purchase header fields**
```sql
alter table purchases
  add column invoice_number text,
  add column invoice_photo_path text,
  add column discount_cents bigint not null default 0 check (discount_cents >= 0),
  add column voided_at timestamptz, add column voided_by uuid references profiles(id),
  add column void_reason text;
create unique index purchases_supplier_invoice_uq on purchases (supplier_id, lower(invoice_number))
  where invoice_number is not null and voided_at is null;
```
`purchase_date` is already there and becomes the delivery date.

**026 line fields**
```sql
alter table purchase_items
  add column free_quantity numeric(12,3) not null default 0 check (free_quantity >= 0),
  add column packs numeric(12,3), add column pack_cost_cents bigint,
  add column line_total_cents bigint,            -- as entered; source of truth for money
  add column allocated_discount_cents bigint not null default 0,
  add column unit_cost_exact numeric(14,4);      -- net cost per unit, used for WAC
alter table products add column pack_size integer not null default 1 check (pack_size >= 1);
```
- `apply_purchase_item` gets `create or replace`: stock += quantity + free_quantity, and WAC uses `unit_cost_exact` when present, else `unit_cost_cents`. Old rows behave exactly as before.
- Backfill `line_total_cents = round(quantity * unit_cost_cents)` for existing rows.

**027 `void_purchase` RPC** (2.1). Revoke delete on purchases.

**028 supplier money**
```sql
create table supplier_payments (
  id uuid primary key,                 -- client operation id = idempotency key (C11 pattern)
  supplier_id uuid not null references suppliers(id),
  amount_cents bigint not null check (amount_cents > 0),
  method payment_method not null, paid_at date not null default current_date,
  note text, created_by uuid not null references profiles(id), created_at timestamptz default now()
);
alter type adjustment_reason add value 'supplier_return';
alter table stock_adjustments add column supplier_id uuid references suppliers(id),
                              add column credit_cents bigint check (credit_cents >= 0);
create view supplier_balances as ... where public.is_owner();   -- purchases − credits − payments
create view supplier_monthly as ... where public.is_owner();
```
`purchase_summaries` gets `create or replace` to add invoice number, status, paid, remaining and voided, and to sum `line_total_cents`.

**029 batch-aware expiry (U11)**: rewrite the `expiring_batches` view. Remaining quantity per batch is allocated **FIFO by expiry date** from current stock: the newest-expiring batches are assumed still on the shelf. Formula: `remaining = clamp(stock − sum(qty of batches expiring later), 0, batch qty)`.
- It's an estimate, labelled "≈ restant", and needs no per-sale batch tracking.
- Real per-batch tracking is out of scope for a corner store.

**Later (only if Q1 says yes): 030 pending deliveries**: `purchases.status`, nullable line costs, `purchases_cashier_view`, and an owner "À valoriser" queue.

### 3.5 Build plan (small PRs, one concern each)

| PR | Content | Depends on |
|---|---|---|
| **R1** | Migration 024 `receive_delivery` + client `operation_id` retained in the draft until success; receive screen uses it; price updates inside. Tests: retry after lost response = 1 purchase; payload mismatch rejected; invalid date rejected readably; live test against local. **Fixes C03 and C07.** | — |
| **R2** | Receive screen hardening: real date picker for expiry; delivery-date field; draft persisted to AsyncStorage; quantity cap and confirm; translate hardcoded strings in StockInLine, ProductSearchPicker and adjustment reasons; submit latch. | R1 |
| **R3** | `adjust.tsx` adopts T02's `record_stock_adjustment` with a retained operation id. **Closes C11 for adjustments.** | T02 merged |
| **R4** | `import_opening_stock` RPC; import screen shows per-row results; re-run safe. **Fixes C10.** | R1 |
| **R5** | Migration 027 `void_purchase` + "Annuler la livraison" in the delivery detail (detail screen read-only version first). Revoke delete. | R1 |
| **R6** | Migrations 025/026: invoice number (+ duplicate-invoice guard), invoice discount, free units, cartons, `line_total_cents`. Receive UI for each. | R1 |
| **R7** | New purchase history: list with filters and paging, delivery detail, per-month drill-down. | R5, R6 |
| **R8** | Migration 028 supplier payments, returns and balances; supplier page; "paid on delivery". | R7 |
| **R9** | Exports: CSV (formula-safe) and PDF (RTL); invoice, statement, monthly. | R7, R8 |
| **R10** | Invoice photo: storage bucket + policies, capture, upload with retry. | R6 |
| **R11** | Migration 029 FIFO expiry estimate. **Fixes U11.** | — (any time) |
| **R12** | (if Q1) Pending deliveries by cashier. | R1, R6 |

Every PR: `npm run check`, a new `tests/stock/*` unit test for any math (the WAC with free units, discount allocation, carton totals and FIFO remaining are all pure functions mirrored in `src/lib/stock/math.ts`), and the live `cashierIsolation` suite extended when the PR adds cost-bearing columns.

---

## Decisions (2026-10-31)

| # | Question | Decision |
|---|---|---|
| 1 | Who receives deliveries? | **Owner only** for now. Enforced in the database by R1. Cashier pending-deliveries are not scheduled. Expiring and Low stock stay owner-only for now. |
| 2 | Correcting a wrong delivery | **Void and re-enter, never edit in place.** Exact void semantics in 2.1.1. |
| 3 | How far back may a delivery be dated? | 60 days, never in the future. |
| 4 | Supplier credit: invoice by invoice, on account, or always paid on delivery? | **Open.** The decision came back unanswered. The design keeps the default (on account, payments applied oldest invoice first for the paid/unpaid badge) until answered. Only R8 depends on it. |
| 5 | Returns to supplier | Credit on the supplier balance; replacement goods entered as a normal delivery with free units. |
| 6 | Bonus units | Spread the cost over all units. Free units are **excluded from "last price paid"** and the price alert. |
| 7 | Cartons | `pack_size` on the product, editable on the line. |
| 8 | Invoice discount | Spread across lines by value (largest remainder), as for sale discounts. |
| 9 | Invoice number | Optional, with a duplicate warning when given. |
| 10 | Invoice photo | Keep 24 months, then delete automatically. |
| 11 | Expiry | FIFO "≈ remaining" estimate. |
| 12 | Offline receiving | Draft saved on the device (R2). Saving the delivery needs a connection, with a full offline queue later only if needed. |
| 13 | Large-quantity confirm | Above 1 000 units or 100 kg per line. |
| — | Money source of truth | **The line total the owner enters.** 100.00 DH stays 100.00 DH; the unit cost is derived (2.8). |

## Appendix A: raw reproduction output (local Supabase, 2026-10-31)

```
## C03 retry after price-update failure
attempt 1: error shown -> "new row for relation "products" violates check constraint "products_selling_price_cents_check""
attempt 2: error shown -> "new row for relation "products" violates check constraint "products_selling_price_cents_check""
after 2 Save presses: 20.000 stock, cost 600 | purchases: 2

## C07 non-atomic header/items + 2026-02-31
screen regex accepts 2026-02-31: true | '31/03/2026' silently becomes null: true
save 1 error: date/time field value out of range: "2026-02-31"
after fix+retry: 5.000 stock, cost 500 | headers: 2 | empty headers: 1

## C10 CSV opening stock partial import
run 1 result: {"inserted":2,"openingLines":2,"errors":["Opening stock for 2 products failed: numeric field overflow"]}
actual opening lines saved: 0 | products created: 2 | stock a: 0.000
run 2 (owner fixes row b and re-imports):
   {"inserted":0,"openingLines":0,"errors":["duplicate key value violates unique constraint \"products_barcode_key\""]}
  empty opening headers left behind: 1

## C11 adjustment retry (adjust.tsx -> createAdjustment)
attempt 1: committed (pretend response lost)
attempt 2: committed (pretend response lost)
after: 14.000 stock, cost 400 | adjustment rows: 2 (expected 17 stock, 1 row)

## U11 expiry tracks delivered, not remaining
all 10 of batch A sold, batch B (120 days) on shelf. Expiring-in-7-days shows:
[{"product_name":"ZZ-REPRO U11","delivered_quantity":10,"stock_quantity":10,"expiry_date":"2026-11-05","days_left":5}]

## Edge probes
cashier header insert (no RETURNING): accepted   | cashier item insert: RLS violation, stock/WAC unchanged
typo fix: update purchase_items -> 0 rows (no policy); delete purchase -> stock 110 / WAC 691 unchanged, 1 orphan cost_history row
free units: 10 @ 6.00 then 2 @ 0 -> 12 stock, WAC 500
carton: 100 DH / 24 -> unit 417 -> line total 10008 (invoice 10000)
same product twice in one delivery (API): accepted
quantity 1e9: numeric field overflow
```

The C03 failure was injected with an invalid selling price. A network failure or lost response at the same point gives the same result: the code path doesn't depend on why the third call failed.
