# Efficiency plan: what to add so daily work is faster

Status: proposal, no app code. Written 2026-10-31 against `main` at `d8da64c` (R1 #16 and the launch quick wins #17 merged).

**Scope.** This pass is only about **adding** things that save time. It doesn't repeat findings from:
- `docs/UI-REVIEW.md` (consistency, contrast, i18n gaps, error states, sidebar on phone);
- `docs/SELL-GRID-DESIGN.md` (category grid, pads, × Qté, Divers, camera upgrades, touch-only laptop T1–T4);
- `docs/STOCK-IN-DESIGN.md` (R1–R12: voids, cartons, invoices, supplier balances, history).

Where an idea here touches one of those plans, section 4 says how it fits.

---

## 1. Timing the real jobs today

### 1.1 Method

- **Measured on web.** I built the web export from `main`, served it gzipped (as a CDN would) against local Supabase with the seed data, and drove every job with Playwright.
  - The script counts every tap, keystroke and scroll.
  - It records **how long the app made the person wait** (search debounce, network, render), from the action to the next control being usable.
  - Each job ran 3 times unthrottled, and once with a **mid-range tablet profile**: 4× CPU slowdown, 4G at 9 Mbit/s with 70 ms latency, close to a real Android tablet talking to hosted Supabase.
  - The harness is in `docs/efficiency/` (`jobs.cjs`, `startup.cjs`) so it can be rerun after each change.
- **Native tablet and phone are derived, not measured.** There is no Android device or emulator in this environment. Tap counts for the camera path come from the code, the same way `SELL-GRID-DESIGN.md` §1.2 counted them. The first check on the preview APK should replace them with real numbers (§1.4).
- **Seconds are an estimate.** Measured app wait plus a simple human model:

  | Action | Time |
  |---|---|
  | Tap on a ≥ 48 dp target | 1.0 s |
  | Soft-keyboard character | 0.4 s |
  | Camera scan (pick up, align, beep) | 1.5 s |
  | Scroll and re-find | 1.5 s |
  | Read a result list and choose | 0.8 s |

  The model is deliberately simple. Use the numbers to compare options, not as stopwatch truth.

### 1.2 Results

"Web" is the touch-only laptop or tablet browser with typed search (the laptop's USB scanner path is already 0 taps per barcoded item). Native columns assume camera scanning for barcoded items, as decided.

| Job | Web: measured taps · keys · app wait (tablet profile) | Web est. | Native tablet est. | Native phone est. | What's slow |
|---|---|---|---|---|---|
| **5-item sale, 1 weighed** (4 barcoded + 1.25 kg bananas, exact cash) | 17 · 23 · 5.9 s | **≈ 36 s** | ≈ 23 s (12 taps, 5 keys, 4 scans) | ≈ 26 s (+2 scrolls: cart lines are tall) | Each typed lookup waits 285 ms (250 ms debounce + query) before results appear. Typing names on a soft keyboard is the bulk. |
| **Credit sale** (1 item) | 6 · 4 · 1.4 s | ≈ 10 s | ≈ 8 s | ≈ 8 s | Fine. Customer chips have no search; the grid plan's step 0e fixes that. |
| **Repayment later** | 4 · 2 · 0.3 s | ≈ 5 s | ≈ 5 s | ≈ 6 s | **The credit screen has no search.** With 50 regulars, finding the customer is a scroll. |
| **Receive a 10-line delivery** (owner, costs unchanged) | 33 · 71 · 9.6 s | **≈ 79 s** | ≈ 63 s (picker camera scan per line) | ≈ 70 s | The Stock In product search waits **≈ 790 ms per lookup** (300 ms debounce plus a fetch of full owner rows), 8 s per delivery. The camera picker closes after each scan. The same supplier's delivery is retyped from scratch every time. |
| **Why is today's profit low?** | 2 · 0 · 0.7 s + 6 scrolls | ≈ 40 s, **often no answer** | same | same | Reports show what happened, not why. There's no comparison to a normal day, no total of discounts given, and no list of items sold with a missing or zero cost (the seed has one). |
| **End-of-day check** | 7 · 0 · 0.9 s + 6+ scrolls | **can't be done in the app** | same | same | No cash-expected figure and no sales-by-method totals. **Sales history loads only the last 50 sales** (`fetchRecentSales(limit = 50)`), so on a 200-sale day most of the day isn't visible. In practice this is a 10–15 min reconciliation with a calculator, or it doesn't happen. |
| **New product found on the shelf, no barcode** | 7 · 16 · 0.6 s | ≈ 17 s, + ≈ 8 s to put its stock in via Stock In | ≈ 20 s + stock | ≈ 22 s + stock | Two separate screens: create the product, then receive stock. The same flow at launch, × the whole catalog, is the single biggest time cost in the app's life (§2, item 2). |

### 1.3 Startup (measured, web)

| | Unthrottled | Tablet profile |
|---|---|---|
| Open the app cold → sign-in screen | 0.14 s | **1.2 s** |
| Sign in → Sell ready to scan | 0.06 s | 0.23 s |
| Sign in → offline product cache filled (200 products) | 0.15 s | 0.39 s |
| Open the app warm (signed in) → ready to scan | 0.15 s | **1.3 s** |

- **Bundle size.** The web bundle is one 2.07 MB file (526 KB gzipped) with no code splitting.
- **Verdict: startup is not a bottleneck on web.** The PWA service worker the grid plan already schedules (T2) makes warm opens near-instant on the laptop.
- **Not measured: native.** It needs one measurement on the preview APK (§1.4) before deciding anything there.

### 1.4 First thing to do on the real tablet

Install the preview APK and measure:
- **Cold start:** `adb shell am start -W -n com.cornichemarket.app/.MainActivity` (the TotalTime line).
- **Jobs 1 and 3:** time them with a stopwatch.

That replaces the native estimates above with real numbers. It costs 15 minutes and decides whether native startup needs any work at all.

---

## 2. Ranked additions

**Volume assumptions** behind "time saved per day". Please correct them (Q1); the ranking is robust to ±50%.

| Activity | Per day |
|---|---|
| Sales | 200, averaging 2.5 items |
| Items without a barcode | 40% |
| Weighed lines | 15 |
| Credit sales / repayments | 15 / 6 |
| Deliveries (avg 10 lines) | 1.5 |
| Owner↔cashier device switches | 5 |
| Screen wake-and-unlocks between customers | 40 |
| First searches that fail | 10% |
| Launch catalog | ~1 000 products |

Ranked by **time saved per day × how often it's used**. "Effort": S < 1 day, M 1–3 days, L > 3 days.

| # | Addition | Platform | Time saved | Effort | When |
|---|---|---|---|---|---|
| 1 | **End-of-day close** ("Clôture de caisse") | All | **≈ 13 min/day**, plus it catches cash gaps the same day | M | **Before launch** |
| 2 | **Catalog setup from the camera** (unknown barcode → quick-add with stock) | Tablet, phone | **≈ 6 hours once at launch**, then ≈ 20 s per new product | M | **Before launch** |
| 3 | **Tablet lands in landscape; screen stays awake on Sell** | Tablet, phone | ≈ 2 min/day of unlocks; the landscape fix is a prerequisite for the grid's tablet layout | S | **Before launch** |
| 4 | **Search that finds what was meant** (accents, Arabic/French aliases, typos) | All | ≈ 2 min/day at the counter, more during receiving | S + S | **Before launch** |
| 5 | **Faster receiving: repeat last delivery, scan-to-add, local picker** | All (owner) | ≈ 60 s per delivery ≈ 1.5 min/day | M | Soon after |
| 6 | **Quick user switch with a 4-digit PIN** | Tablet, phone | ≈ 2.5 min/day, and sales credited to the right person | L (needs C05 first) | Soon after |
| 7 | **"Pourquoi ?" panel on Reports** | All (owner) | ≈ 1 min/day averaged; today the question often has no answer | M | Soon after |
| 8 | **Reorder list → supplier on WhatsApp** | All (owner) | ≈ 1.5 min/day averaged (2–3 orders a week) | S–M | Soon after |
| 9 | **Credit: search + WhatsApp balance reminder** | All | ≈ 1 min/day | S | Soon after |
| 10 | **Undo the last added line from the "Ajouté X" message** | All | ≈ 30 s/day | S | Soon after (with grid step 3) |
| 11 | **Owner badges instead of notifications** (low stock, expiring, negative) | All | ≈ 30 s/day, and nothing missed | S | Soon after |
| 12 | **Remember filters, ranges and tabs per screen** | All | ≈ 15 s/day | S | Later (cheap, any time) |
| 13 | **Inline price edit and sort in the products list** | Web, tablet (owner) | ≈ 15 s/day | M | Later |
| 14 | **Printable shelf price labels** for price changes | Web (owner) | a few min/week | M | Later |

### Details

**1. End-of-day close.** One screen, reachable from Sell and Reports. It shows for the day (store timezone):
- sales by payment method (cash / card / credit);
- credit repayments received in cash;
- voids and refunds, with count and amount;
- stock losses (adjustments);
- Divers total (once the grid ships);
- **cash expected** = opening float + cash sales + cash repayments − cash refunds.

The person closing types the **counted cash**. The app shows the difference and stores the close: who, when, expected, counted, note.
- **Cashier view:** a cashier can run it and sees only cash figures, no cost or profit.
- **Owner view:** the owner sees the full summary, plus a history of closes with their differences.
- **Data:** a new owner-readable `day_closes` table (cashiers can insert their own close) and one RPC `report_day_close(p_day)`, built from the same `sale_line_economics` / payments data the reports already use.
- **Why first:** it is the one daily control a shop owner can't do in the app today at any number of taps, and it's where theft and mistakes show up.

**2. Catalog setup from the camera.** Production starts empty. Entering ~1 000 products one at a time takes 7 taps and 16+ keys in Products → New, then a separate Stock In line. That's ≈ 40 s each, **≈ 11 hours** in total.
- **The flow:** an owner-only "Mise en place du catalogue" mode keeps the camera open. A known barcode shows the product (skip). An unknown one opens a quick form with the barcode already filled: name, price, category (last one remembered), **quantity on the shelf** and **unit cost**. Saving creates the product and its opening stock in one go, through the same `receive_delivery` RPC (one delivery per session, so cost and stock still only come from the trigger). Then it's straight back to the camera.
- **Time:** ≈ 18 s per product, **saving ≈ 6 hours** before opening day.
- **After launch:** the same quick form opens when the owner scans an unknown barcode on Sell ("Créer ce produit ?"). That's cheap once the form exists.
- **Optional, later (Q6):** prefill the name from Open Food Facts. Only the barcode is sent, and many Moroccan products are listed there.

**3. Landscape and keep-awake.**
- **Orientation:** `app.json` sets `"orientation": "portrait"`, which **forces the primary counter tablet into portrait**. Every tablet layout in the grid plan assumes landscape. Set `"default"`, then lock at runtime with `expo-screen-orientation`: landscape on tablets (shortest side ≥ 600 dp), portrait on phones.
- **Keep-awake:** `expo-keep-awake` on the Sell screen only, so the screen doesn't sleep between customers. That's ≈ 3 s per wake and unlock, ~40 times a day.

**4. Search that finds what was meant.** Today `name ilike '%term%'` online and `includes()` offline. Measured on the seed catalog:

| Typed | Today | Wanted |
|---|---|---|
| `cafe` | 0 results | Café Maxwell House 200g |
| `coca cola` | 0 | Coca-Cola 1.5L / 33cl |
| `dentifrise` | 0 | Dentifrice Signal |
| `كوكا` | 0 | Coca-Cola |

75 of the 200 seed products have Arabic names, so a cashier typing in the other script finds nothing. Three pieces:
- **(a) Normalization, both online and offline (S).** Lowercase; strip Latin accents; Arabic normalization (أ إ آ → ا, ة → ه, ى → ي, remove tatweel and short vowels); treat hyphens and spaces alike. Server side, a stored generated `search_key` column with a trigram index. Offline, the same pure function over the cache. It's tested, and the client and SQL versions are checked against the same cases.
- **(b) Typo fallback (S).** `pg_trgm` is already installed, with a trigram index on `name`. When the normal match returns nothing, rank by `word_similarity`. Offline, a small edit-distance fallback over the cache.
- **(c) Aliases (S).** An optional "autres noms" field on the product (e.g. `كوكا, coca`), included in `search_key` and the cache. Transliterating between scripts automatically isn't reliable, and the owner knows what customers ask for.

The cost: two migrations (a column and an index) and one pure function. **Before launch**, because until the grid ships, search is how every no-barcode item is sold.

**5. Faster receiving.**
- **"Répéter la dernière livraison"** after picking a supplier prefills that supplier's last delivery: same products, last costs, quantities blank or last. The owner edits quantities and saves. A 10-line delivery drops from ≈ 79 s to ≈ 20 s.
- **Continuous scan-to-add.** In the Stock In picker the camera stays open. Each scan adds a line, or +1 to an existing line. Today the camera closes after each scan.
- **Local cache in the picker.** Product lookup in Stock In reads the local cache first (instant, works offline). Today it waits ≈ 790 ms per lookup.

All three use the existing `receive_delivery` RPC. No schema change.

**6. Quick user switch with a PIN.** The counter tablet is shared: the owner signs in to receive stock and check reports, cashiers to sell. Today a switch is Settings → Se déconnecter → email + password (≈ 30 characters), about 35 s. Because people avoid it, sales get credited to whoever is still signed in. With quick switch: tap the user badge → pick a person → 4-digit PIN, about 5 s.
- **Design:** each person enrolls once per device with email and password. The app keeps each person's session in secure storage (`expo-secure-store` on native; on web, see Q4). The PIN unlocks a stored session locally, checked against a salted hash, with a lockout after 5 wrong tries. An idle timeout returns to the picker.
- **Blocking dependency: audit C05 is still open.** A queued offline sale carries no cashier, and `record_sale` stamps `auth.uid()` at sync time. With fast switching, offline sales would be credited to the wrong person even more often. C05 has to ship first: the pending sale carries its cashier, and the server accepts it only for the signed-in session's own sales or an owner.

**7. "Pourquoi ?" panel.** Under today's profit, compare against the same weekday's average over the last 4 weeks, and list the biggest contributors to the gap:
- discounts given (total, top 3 sales);
- voids;
- stock losses;
- revenue from items sold with **no recorded cost** (their profit shows as 100%, so they inflate it, or cost 0 when the price is also wrong);
- low-margin lines;
- the Divers estimated share.

It's one RPC over existing data, and it makes the 2-tap + 6-scroll hunt a 1-tap answer.

**8. Reorder via WhatsApp.**
- **The message:** on Low stock, "Envoyer au fournisseur" groups the suggested quantities by each product's **last supplier** (from `purchase_items`). It builds a plain-text order in the app language and opens WhatsApp through the system share sheet, or `whatsapp://send?phone=` when the supplier has a phone number. No WhatsApp API, no account.
- **Today:** the screen already computes the quantities and exports CSV. Nobody sends a CSV to a distributor; they send a message.

**9. Credit: search and reminder.** A search field on the credit screen (the same `filterCustomers` function the grid plan's step 0e builds for the payment sheet). Also a "Rappel WhatsApp" per customer with their balance and last purchases, in the app language. Share-sheet only.

**10. Undo the last line.** The green "Ajouté Bananes" message already appears after every add. Make it a button, "Ajouté Bananes · Annuler", for a few seconds. It removes exactly what that action added: the line, or the extra quantity merged into an existing line. That's 1 tap instead of finding the line and its small "Retirer". It belongs in grid step 3, which rebuilds the cart lines anyway.

**11. Owner badges.**
- **Badges:** counts on the Stock tab (low stock, expiring in 7 days, negative stock) and on the end-of-day close.
- **Why not push notifications:** they need push tokens, a server-side schedule and permission prompts for a single owner who opens the app every day anyway (see §3).

**12. Remember view state.** Per device, in AsyncStorage: the Reports range, the Products filters, the purchase-history tab, the expiring range. The grid plan already remembers the last grid tab; same mechanism, no new pattern.

**13. Inline price edit.** In the owner's Products list: tap a price → number pad → saved. Plus sorting by margin and by stock. Price changes after deliveries already go through Stock In's suggested price (R1), so this is for corrections. Later.

**14. Shelf labels.** After a bulk price change or a delivery with new prices, "Imprimer les étiquettes" makes an A4 PDF of the changed prices (`expo-print`, already installed), with RTL support. Later, only if the owner prints price tags at all (Q8).

---

## 3. What not to build

| Idea | Why not, for one convenience store |
|---|---|
| **Push notifications** for low stock and expiry | Push tokens, a scheduled server job and permission prompts for one owner who opens the app daily. Badges and the close screen (items 1 and 11) cover it with no infrastructure. |
| **Printed barcode labels** for products without one | The grid gives every no-barcode product a tile (`SELL-GRID-DESIGN.md` 2.2), which is faster than scanning a label. Labels add a printer, paper and sticking time for no gain. |
| **"Recently sold" row on Sell** | It reorders itself constantly, against the grid's rule that tiles never move under the cashier's thumb (`SELL-GRID-DESIGN.md` 2.1 principle 2, decision 1). Favoris plus undo (item 10) cover the need. |
| **Receipt per sale via WhatsApp** | Corner-shop customers rarely ask for a receipt. The useful message is the credit balance reminder (item 9). |
| **Bluetooth 58 mm printer** (now) | Driver and pairing quirks per printer model, a native module, and paper for receipts nobody asked for. Revisit only if credit customers ask for printed statements. |
| **Keyboard shortcuts + help overlay** | The laptop is decided touch-only with a USB scanner (decision 18). Shortcuts help nobody without a keyboard. The pads already accept a keyboard where one exists. |
| **Drag-and-drop CSV import** | Import already has a column-mapping preview. Drag-and-drop needs a mouse; the counter laptop has none. |
| **Printable reports** | The Reports screen already exports CSV and PDF. |
| **Startup optimization work** | Measured 1.3 s on a throttled tablet profile. The grid plan's PWA (T2) covers the laptop. Native waits for one real measurement (§1.4). |
| **Generic "fast tables"** for purchases | Purchase history with filters and paging is already Stock In R7. A second table system would duplicate it. |

---

## 4. How this fits with the grid and Stock In plans

| Addition | Relation to existing plans | Conflict? |
|---|---|---|
| 1 End-of-day close | New. Reads the same data as Reports; adds Divers lines once grid step 6 exists (until then the row is hidden). | None |
| 2 Catalog setup | New. Writes opening stock through **R1's `receive_delivery`**, so cost and stock still only change via the trigger. Replaces part of R4's CSV opening-stock path for stores without a supplier CSV; R4 stays for bulk files. | None; complements R4 |
| 3 Landscape / keep-awake | **Prerequisite for the grid's tablet layout** (2.7), which assumes landscape but the app is locked to portrait today. | None; do it before grid step 3 |
| 4 Search | Used by Sell search, Stock In picker, credit search (grid step 0e) and the grid's in-app keyboard search (T3). One `normalizeSearch()` for all. | None; build before 0e and T3 so they reuse it |
| 5 Faster receiving | Additions to the R1 screen. Do after **R2** (which reworks the same screen: date picker, draft persistence) and before **R6** (cartons and line totals change the line model; "repeat" then copies those fields too). | Sequencing only |
| 6 PIN switch | Needs audit **C05** (queued sales bound to their cashier) first. Independent of grid and Stock In; owner-only screens stay owner-only by role, unchanged. | None |
| 7 "Pourquoi ?" | Reports addition. Uses grid step 6's Divers estimate when present. | None |
| 8 Reorder WhatsApp | Low-stock screen addition. Uses suppliers' phones (exist today); supplier pages come with R7/R8 later. | None |
| 9 Credit search + reminder | Search reuses grid step **0e**'s `filterCustomers`. | None; share the function |
| 10 Undo last line | Build **inside grid step 3** (compact cart lines), not before, to avoid touching the cart twice. | None if sequenced |
| 11 Badges | Uses existing views (low stock, expiring, negative). Expiry counts become accurate after **R11** (FIFO estimate). | None |
| 12 Remember view state | Same AsyncStorage pattern as the grid's last tab. | None |
| 13 Inline price | Products list; R1 already handles post-delivery prices. | None |
| 14 Shelf labels | Uses `expo-print`; RTL PDF fix shared with R9's RTL exports. | None; share the PDF helper |

**Suggested order (before launch):** 3 → 4a/4b → 1 → 2, in parallel with the remaining grid steps 0e and 1–4 and Stock In R2. Items 3 and 4 are small and unblock others; items 1 and 2 are the two that pay for themselves in the first week.

---

## 5. Questions for you (with my recommended default)

1. **Real daily volumes:** sales per day, how many cashiers, how often the owner takes the counter tablet? *Default: 200 sales, 1–2 cashiers, owner takes the tablet ~5 times a day. The ranking above uses these.*
2. **Opening cash float:** fixed amount or counted each morning? *Default: carried from the last close (counted cash minus what the owner takes out), editable.*
3. **Who closes the day?** *Default: the cashier counts and closes (cash figures only); the owner sees the full summary and every close's difference.*
4. **PIN switch on the web laptop:** store several people's sessions in the browser, or keep normal sign-in there? *Default: PIN switch on the tablet and phone only (secure storage); normal sign-in on web until the laptop is in daily use.*
5. **PIN for owner screens on a shared tablet:** require the owner's PIN to open Stock In and Reports even if the owner is the signed-in user? *Default: no; the idle timeout (2 minutes on owner screens) returns to the user picker instead.*
6. **Open Food Facts name lookup during catalog setup** (sends only the barcode to an external service)? *Default: off at launch; revisit if typing names is the slow part.*
7. **Tablet orientation:** lock landscape on tablet and portrait on phone? *Default: yes.*
8. **Do you print shelf price tags today?** *Default: no, so item 14 stays "later".*
9. **Aliases:** should the owner enter Arabic/French alternative names, or only rely on automatic normalization? *Default: normalization for everyone, plus an optional alias field the owner fills when a search fails.*
10. **Reorder grouping:** by each product's last supplier? *Default: yes; a product never bought yet goes to a "sans fournisseur" group to edit by hand.*
