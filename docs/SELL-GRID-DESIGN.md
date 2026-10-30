# Sell screen: UX assessment and product grid design

Status: proposal, no code written. Assessed against `main` at `4cddc78`.
Scope: `app/(app)/sell/index.tsx`, `src/components/sell/*`, `src/lib/products/offlineCache.ts`, `src/lib/sales/totals.ts`.

Method: code read plus a live run of the web build against local Supabase as the seeded cashier (desktop width, 375 px phone width, Arabic). Items marked **[verified]** were reproduced in the browser, not just read in code.

---

## Part 1: Assessment of today's Sell screen

### 1.1 Fix these first: they cost money

These are bugs, not UX polish. They should ship as small fixes before any grid work.

| # | Problem | Where | Effect |
|---|---|---|---|
| C1 | **The kg field swallows the decimal separator.** **[verified]** The input is controlled with `value={String(line.quantity)}` and re-parses on every keystroke. Typing `0` then `.` parses `"0."` back to `0`, so the dot disappears and the next `5` gives `5`. `0,5`, `.5` and `1.5` fail the same way. Only pasting works. | `CartLineRow.tsx:44-50` | Typing 0.5 kg of courgettes at 9 DH/kg charged **45.00 DH instead of 4.50 DH** in the live test. Weighed items can't be entered correctly by typing. |
| C2 | **The payment sheet keeps the previous sale's choices.** **[verified]** `PaymentSheet` stays mounted, and nothing resets `method`, `customerId` or `tendered` after a sale. | `PaymentSheet.tsx:34-37`, `sell/index.tsx:205-208` | After a credit sale to Fatima Zahra, the next customer's sheet opened on "Pay later" with Fatima selected and "Complete sale" enabled. **One tap puts a stranger's basket on her credit.** Stale `tendered` also shows wrong change. |
| C3 | **Online barcode lookup is a fuzzy search.** `addByBarcode` calls `fetchProducts({search: code})`, which runs `name ilike *code* OR barcode ilike code*`, sorts by name and takes the first row. Offline it uses an exact match. | `sell/index.tsx:140-144` | A short code (EAN-8, an in-store code like `1234`, or digits that appear in a product name) can add **the wrong product**, but only when online. The exact `findByBarcode()` already exists in `products/queries.ts:107`. |
| C4 | A new kg line starts at **1 kg**. | `sell/index.tsx:121` | If the cashier forgets to edit it, the customer is charged 1 kg. |

### 1.2 Tap counts today

Counted from an empty cart to a recorded sale. Phone is native with the camera. Cash is paid exact (Charge + Complete = 2 taps, after the C2 fix so the sheet opens on cash). Keystrokes are counted separately from taps.

| Scenario | Taps | Typing | Notes |
|---|---|---|---|
| 1. One scanned item, phone camera | **4**: Scan, Done, Charge, Complete | 0 | Web with a USB scanner: **2** (Charge, Complete). |
| 2. One item with no barcode (bread) | **5**: search field, result, dismiss keyboard, Charge, Complete | ~4–6 letters | Online search waits 250 ms debounce + a network round trip. The keyboard hides Charge, so it has to be dismissed. |
| 3. Three of the same barcoded item | **6**: Scan, Done, +, +, Charge, Complete | 0 | No multiplier and no direct quantity entry for pieces. 12 bottles = 11 taps on +. The no-barcode version is **7** taps plus typing. |
| 4. Weighed item, 0.5 kg | **6**: search, result, kg field, dismiss keyboard, Charge, Complete | name + `0.5` | **Can't be done by typing (C1).** Starts at 1 kg (C4). |
| 5. Credit sale, 1 no-barcode item, existing customer | **7**: search, result, dismiss keyboard, Charge, Pay later, customer, Complete | ~4–6 letters | All customers appear as chips with no search. Past ~20 regulars this becomes a wall of names. |

### 1.3 What's slow, hidden, too small, or confusing

**Speed**

- **Anything without a barcode needs typing**, plus a network round trip when online. Bread, eggs, loose produce and cigarettes by the unit are the bulk of a corner shop's no-barcode sales. This is what the grid addresses.
- **No quantity multiplier.** The only way to add N pieces is N taps on + or N scans. The camera's 1.5 s duplicate filter (`ContinuousScanner.tsx:13`) makes repeated scans slow too.
- **Search results push the cart down** and stay until the field is cleared. The keyboard covers the footer (there's no `KeyboardAvoidingView`), so Charge can't be reached without dismissing it.
- The **"Added X" flash never clears.** It stays until the next action and shifts the layout.
- The **cart isn't persisted.** Reloading the web tab or killing the app mid-sale loses the basket **[verified on web]**.

**Too small (below 48 dp)**

- The "Crédit" and "Ventes" header links are 15 px text with no minimum height, about 20 dp tall.
- "Retirer" (remove line) is 14 px text with an 8 dp hit slop, about 30 dp.
- Everything else meets 48 dp: steppers, inputs, Charge.

**Wasted space**

- A cart line holds three controls (quantity or kg, discount, remove) plus a unit-price line, so each row is about 150 dp tall. A phone shows 2–3 lines. On the short web viewport, one line was half visible under the footer **[verified]**.
- The **sale-level discount field always takes a row** in the footer, even though it's rarely used.

**Phone (6", native)**

- **Search and Scan sit at the top**, out of thumb reach, and the Scan button is in the far corner for a right-handed thumb. Charge at the bottom is well placed.
- The bottom tab bar takes about 56 dp from a screen that's already short of vertical space.

**Tablet**

- One stretched column. Cart rows span the full width, about half the screen is empty, and there's no side-by-side layout.
- On Android or iOS with a **USB or Bluetooth (HID) scanner**, the keyboard-wedge hook is web-only (`useKeyboardWedge.ts:20`). Scans only land if the search field happens to have focus, Enter isn't handled, and each scan then needs a tap on the result. A tablet at a counter is exactly where people plug in a scanner.

**Web with a USB scanner**

- The wedge works well **[verified]**: 0 taps per item, and it's paused while the payment sheet is open.
- **The 220 px sidebar is always shown**, even on a phone-width browser, which leaves the Sell screen about 150 px wide **[verified]**.
- No camera button on web. That's correct and intentional.

**Text and language**

- **Hardcoded English** in `PaymentSheet` ("Cash received", "Short by", "Change", "Who is paying later?", "New customer name", "Add", and the raw method names `cash`/`card`), in `ContinuousScanner` (every string), in the Stack titles in `sell/_layout.tsx`, and in `CartLineRow` (the `kg` label and `/ piece`).

### 1.4 RTL (Arabic)

- The layout mirrors correctly: sidebar on the right, search and footer flip **[verified]**.
- **No `isolateBidi` on product names** anywhere in the Sell flow: cart lines, search results, the flash message, customer chips. A Latin name next to Arabic labels (or the reverse) can reorder neighbouring numbers. The Reports screen already shows the right pattern.
- The untranslated strings above show up as English inside an Arabic screen.
- The discount inputs hardcode `textAlign: "right"`. That's fine for numbers and doesn't need to change.

### 1.5 One-handed use (6" phone, right hand)

| Element | Reach | Verdict |
|---|---|---|
| Charge | bottom, full width | good |
| Steppers, remove | mid-screen | ok |
| Search / Scan | top | poor: needs a second hand or a regrip |
| Crédit / Ventes links | top corner, tiny | poor, but rarely used |
| Payment sheet buttons | lower half | good |

---

## Part 2: Design for the category product grid

### 2.1 Principles

1. **The grid is an addition.** Search, camera scan and the keyboard wedge behave exactly as today. Typing in search temporarily replaces the grid with results. Clearing the search brings the grid back on the same tab.
2. **Muscle memory beats cleverness.** Tiles don't move unless the owner moves them. Nothing re-sorts automatically under the cashier's thumb.
3. **No cost data, ever.** Grid tables hold no money columns. Tiles read name, price and unit from the cashier-safe product cache, and a tile never puts a cost into the cart (`unit_cost_cents: null`; the server stamps cost as it does today).
4. **Works offline.** The layout is cached with the products.

### 2.2 Tiles

```
┌────────────────┐   ┌────────────────┐   ┌────────────────┐   ┌────────────────┐
│ Pain rond      │   │ Tomates        │   │ Recharge       │   │ Coca-Cola 33cl │
│                │   │                │   │                │   │           ×3   │ ← already in cart
│ 1.20 DH        │   │ 9.00 DH/kg  ⚖ │   │ Prix libre  ✎ │   │ 7.00 DH        │
└────────────────┘   └────────────────┘   └────────────────┘   └────────────────┘
   piece/pack           weighed             open price            in cart
```

- **Size.** At least 64 dp (the requirement), aiming for 88–104 dp on phones (3 columns at 360 dp width) and about 120 dp on tablets (5–6 columns). An optional per-device setting offers S, M or L.
- **Content.** The name takes up to 2 lines, is wrapped in `isolateBidi()`, and aligns to the start edge. The selling price is bold and always LTR-isolated. A small icon marks weighed (⚖) or open-price (✎) items. A **"×N" badge** shows how many are already in the cart, so the cashier gets instant feedback without looking at the cart.
- **Status badges.** "0" or "Rupture" when stock ≤ 0 (see 2.6). "Inactif" appears only in edit mode.
- **Color.** An optional choice from a fixed **8-color palette**, stored as a key such as `green` or `amber`. Free hex isn't offered. The palette guarantees readable text in light and dark mode, and the value can be validated with a CHECK constraint.
- **Accessibility label.** For example "Pain rond, 1.20 dirhams, 2 dans le panier".

### 2.3 Interactions

| Gesture | Piece or pack | Weighed (kg) | Open price |
|---|---|---|---|
| **Tap** | add 1 (haptic and flash on the tile) | open the **weight pad** | open the **price pad** |
| **Long-press** (400 ms) | open the **quantity pad** | weight pad | price pad |
| **× key, then tap** | add N | — | add N at the entered price |

- **Multiplier key "× Qté".** This is the visible, discoverable alternative to long-press, and a classic POS pattern: tap ×, type `6`, then tap a tile **or scan a barcode**, which adds 6. It also removes the 11-tap problem for scanned items.
- **Pads are custom on-screen keypads, not the OS keyboard.** They avoid the C1 decimal bug entirely: the pad keeps the raw string and parses once on OK. They don't cover the screen and work the same on every platform.

```
 Weight pad (bottom sheet)              Quantity pad                  Price pad
┌──────────────────────────────┐   ┌────────────────────────┐   ┌────────────────────────┐
│ Tomates · 9.00 DH/kg         │   │ Coca-Cola 33cl         │   │ Recharge Inwi          │
│        0.500 kg  = 4.50 DH   │   │          6             │   │      20.00 DH          │
│ [0.25] [0.5] [1] [1.5] [2]   │   │ [2] [3] [6] [12] [24]  │   │ [10] [20] [50] [100]   │
│  7  8  9                     │   │  7  8  9               │   │  7  8  9               │
│  4  5  6                     │   │  4  5  6               │   │  4  5  6               │
│  1  2  3                     │   │  1  2  3               │   │  1  2  3               │
│  ,  0  ⌫                     │   │     0  ⌫               │   │  ,  0  ⌫               │
│ [ Annuler ]   [ Ajouter ]    │   │ [Annuler]  [Ajouter]   │   │ [Annuler]  [Ajouter]   │
└──────────────────────────────┘   └────────────────────────┘   └────────────────────────┘
```

- **Weight-pad presets add immediately.** Tapping `0.5` adds the line and closes the pad, so the common case takes 1 extra tap. Both `,` and `.` are accepted as the decimal separator. Weight is capped at 3 decimals and 99.999 kg. A live price preview appears under the weight.
- **Price-pad presets** are owner-defined for each open-price product (for example 10/20/50/100 for top-ups).
- The pad keys are 64 dp and laid out like a phone keypad, which RTL doesn't mirror.

### 2.4 Owner-only "Edit grid" mode

Entered with a "Modifier la grille" button that only owners see (the role comes from `useAuth()` as everywhere else). Cashiers never see the button, and RLS refuses their writes anyway.

In edit mode:

- **Tabs:** add a tab (pick a category, or "Favoris"), rename the display label, hide or show, drag to reorder, delete. For category tabs there's an "Afficher automatiquement tous les produits de la catégorie" toggle (see `auto_fill` below).
- **Tiles:** "+ Ajouter" opens the existing product search picker (reusing `ProductSearchPicker`). Drag to reorder (with ↑/↓ buttons as an accessible fallback). Tap a tile to set its color or short label, or remove it.
- **"Remplir avec les meilleures ventes"** seeds Favoris with the top 24 products by quantity over 30 days, using the existing `report_product_performance` RPC. It runs once, on demand, and never on its own.
- **Saving needs a connection.** Edits are written straight to the server, with no offline edit queue. Offline, edit mode shows "Connexion requise pour modifier la grille." Every save refreshes the local cache.
- Inactive products stay visible here, greyed out with an "Inactif" badge, so the owner can clean them up.

### 2.5 Data model

New **additive** migration, using whatever number is next free at merge time. There are three Codex branches in flight (`codex/t01…t03`) that may also add migrations, so the filename shouldn't be picked until rebase.

```sql
-- Products the cashier rings up at a price typed at sale time (top-ups, misc).
alter table products add column open_price boolean not null default false;

-- create or replace view can only APPEND columns: open_price goes last.
create or replace view products_cashier_view as
select id, name, barcode, category_id, unit,
       selling_price_cents, stock_quantity, low_stock_threshold, active,
       created_at, updated_at, is_low_stock,
       open_price
from products;

create table sell_grid_tabs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('favorites', 'category')),
  category_id uuid references categories (id) on delete cascade,
  label       text,                 -- null = category name, or translated "Favoris"
  position    integer not null,
  visible     boolean not null default true,
  auto_fill   boolean not null default false,  -- category tabs: append the rest of the category
  updated_at  timestamptz not null default now(),
  constraint tab_kind_matches_category
    check ((kind = 'category') = (category_id is not null)),
  constraint favorites_never_auto_fill
    check (kind = 'category' or auto_fill = false)
);
create unique index sell_grid_one_favorites on sell_grid_tabs (kind) where kind = 'favorites';
create unique index sell_grid_one_tab_per_category on sell_grid_tabs (category_id) where category_id is not null;

create table sell_grid_tiles (
  id          uuid primary key default gen_random_uuid(),
  tab_id      uuid not null references sell_grid_tabs (id) on delete cascade,
  product_id  uuid not null references products (id) on delete cascade,
  position    integer not null,
  color       text check (color in ('green','teal','blue','indigo','purple','red','amber','grey')),
  short_label text check (char_length(short_label) <= 24),
  unique (tab_id, product_id)
);

alter table sell_grid_tabs  enable row level security;
alter table sell_grid_tiles enable row level security;
-- Everyone signed in reads (no cost columns exist here); only the owner writes.
create policy "authenticated reads grid tabs"  on sell_grid_tabs  for select using (auth.role() = 'authenticated');
create policy "owner writes grid tabs"         on sell_grid_tabs  for all    using (public.is_owner()) with check (public.is_owner());
create policy "authenticated reads grid tiles" on sell_grid_tiles for select using (auth.role() = 'authenticated');
create policy "owner writes grid tiles"        on sell_grid_tiles for all    using (public.is_owner()) with check (public.is_owner());

-- Atomic "replace this tab's tiles in this order" so a reorder never leaves
-- half-written positions. security invoker: RLS above still applies.
create function public.set_sell_grid_tiles(p_tab_id uuid, p_tiles jsonb) returns void ...
```

**Per store, not per device.** The layout lives in the database and every device in the shop reads the same grid. Reasons:

- The owner configures it **once**, and the counter tablet, a backup phone and the web register all match. A cashier switching devices finds tiles in the same places.
- It survives reinstalls, a lost phone and a new tablet. A per-device layout lives in AsyncStorage and is gone with the device.
- Cashiers can't edit the grid, so per-device customization would only help the owner, who sets things up on one device anyway.
- It follows the existing `store_settings` singleton pattern: one store, one configuration. If the app ever goes multi-store, add `store_id` to both tables.

Display preferences that really are per device stay local in AsyncStorage: tile size (S/M/L), last selected tab, and whether the phone cart is expanded.

**Offline cache.** Bump the cache key to `corniche.productCache.v2` and store one snapshot:

```ts
type ProductCache = {
  products: CachedProduct[];           // + category_id, stock_quantity, open_price (still NO cost)
  grid: { tabs: GridTab[]; tiles: GridTile[] };
  refreshedAt: string;
};
```

It's refreshed by the same "came online" trigger as today and after every owner save. A pure function `resolveGrid(tabs, tiles, products)` turns the snapshot into what's on screen. That one function owns every edge case in 2.6, which makes it straightforward to test.

### 2.6 Edge cases

| Situation | Cashier sees | Owner in edit mode sees | Data |
|---|---|---|---|
| **Product deactivated** | The tile is **hidden**, because the cache only holds active products and you can't sell an inactive one. | A greyed tile with an "Inactif" badge and a remove button. | The tile row is **kept**, so reactivating restores it in the same place. |
| **Product deleted** | Gone. | Gone. | `on delete cascade` removes its tiles. (Sold products can't be hard-deleted anyway, because `sale_items` references them.) |
| **Category deleted** | Its tab disappears. | Same. | The tab and its tiles cascade. Favoris tiles for those products remain. |
| **Product moved to another category** | A curated tile **stays where the owner put it**. The `auto_fill` section of each tab updates. | Same. | No change. |
| **No stock** (≤ 0) | The tile is **still tappable**, with a "0" badge. Scanning allows overselling today and the app already reports negative stock, so the grid doesn't make it stricter. See open question 3. | Same, plus the low-stock color. | Stock comes from the cache and can be stale offline, just like prices today. |
| **Price changed** | The tile shows the new price after the next cache refresh. | Same. | Same staleness rules as scanning today. |
| **Product created after the last refresh, while offline** | The tile is hidden until the next refresh. | The edit button is disabled while offline. | No change. |
| **Open-price product without a price entered** | The price pad blocks "Ajouter" until the amount is above 0. | — | The server already accepts the client's `unit_price_cents`. |
| **Empty tab, or no grid configured yet** | The tab is hidden. With no tabs at all, Sell looks like today plus a hint that the owner can set up the grid. | An "Ajouter des produits" call to action. | — |

### 2.7 Screen layouts

**Phone, portrait (360 × 800 dp, native)**: the grid takes most of the screen and the cart collapses to a bar.

```
┌────────────────────────────────────┐
│ ● En ligne            Crédit  Ventes│  40 dp  (links get a 48 dp hit area)
│ [🔍 Scanner ou chercher…   ] [📷]  │  56 dp  unchanged search + camera
│ ⭐Favoris │ Boissons │ Boulang. │ ▸ │  48 dp  tabs, horizontal scroll
├────────────────────────────────────┤
│ ┌────────┐ ┌────────┐ ┌────────┐   │
│ │Pain    │ │Lait 1L │ │Coca 33 │   │
│ │1.20 DH │ │8.00 DH │ │7.00 ×2 │   │  grid: 3 columns, ~104 dp tiles
│ └────────┘ └────────┘ └────────┘   │  swipe left/right = change tab
│ ┌────────┐ ┌────────┐ ┌────────┐   │  (thumb-friendly: no reach to the top)
│ │Oeufs   │ │Tomates │ │Recharge│   │
│ │1.50 DH │ │9.00 ⚖ │ │Libre ✎│   │
│ └────────┘ └────────┘ └────────┘   │
│               …                    │
├────────────────────────────────────┤
│ [× Qté]  ▲ 4 articles    17.40 DH  │  56 dp  tap = expand cart sheet
│ [        Encaisser 17.40 DH      ] │  56 dp  thumb zone
└────────────────────────────────────┘
   Vente   Produits   Stock   Réglages     native tab bar
```

The expanded cart is a bottom sheet over the grid, up to 85% height. It has the cart lines and a "Remise sur la vente" link that reveals the sale discount field, which is no longer a permanent row. Swipe down or tap the bar to collapse it.

**Tablet landscape and web (≥ 900 dp)**: grid and cart side by side, cart always visible.

```
┌──────────────────────────────────────────────────┬─────────────────────────────┐
│ ● En ligne  [🔍 Scanner ou chercher…      ] [📷] │ Panier · 4       Crédit Ventes│
│ ⭐Favoris  Boissons  Boulangerie  Laitier  Tabac │ Pain rond   [−] 2 [+]   2.40 │
├──────────────────────────────────────────────────┤ Lait 1L     [−] 1 [+]   8.00 │
│ ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐ │ Tomates     0.500 kg    4.50 │
│ │      ││      ││      ││      ││      ││      │ │ Recharge    1 × 20.00  20.00 │
│ └──────┘└──────┘└──────┘└──────┘└──────┘└──────┘ │  (tap a line: discount,      │
│ ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐ │   remove, edit weight)       │
│ │      ││      ││      ││      ││      ││      │ │                              │
│ └──────┘└──────┘└──────┘└──────┘└──────┘└──────┘ │ ──────────────────────────── │
│                  …  (5–6 columns)                │ + Remise sur la vente        │
│                                                  │ Total            34.90 DH    │
│ [× Qté]                     [✎ Modifier la grille]│ [   Encaisser 34.90 DH     ] │
└──────────────────────────────────────────────────┴─────────────────────────────┘
       grid ~65%                                          cart ~35%, min 320 dp
```

On web, the existing 220 px sidebar sits to the left of this. Below 900 dp the phone layout applies, and the sidebar should collapse into a menu button (a separate fix, see 1.3).

**RTL.** The whole layout mirrors with `appDirection()`: tabs read right to left, the cart sits on the left in landscape, the grid fills from the right, and × Qté and Charge swap sides. Prices, quantities and the keypads stay LTR. Product and category names go through `isolateBidi()`.

**Compact cart lines.** Each line becomes a single 56 dp row (name, quantity control, total). Discount and remove move behind a tap on the line. This alone roughly doubles how many lines fit on a phone.

### 2.8 Tap counts: today vs. with the grid

Same rules as 1.2. "+1" is a tab switch when the item isn't on the open tab. The after column assumes the C1–C4 fixes.

| Scenario | Today | With grid | Change |
|---|---|---|---|
| 1. Scanned item (phone camera) | 4 | 4 (scan is unchanged), or **3** if it's a tile | −1 for tiled items |
| 1b. Scanned item (web, USB) | 2 | 2 | unchanged, as required |
| 2. Item with no barcode | 5 + typing + network wait | **3** (+1) | −2 taps, **no typing**, instant offline |
| 3. Three of the same | 6 (barcoded) / 7 + typing | **5** (+1): tile ×3, Charge, Complete | −1 / −2; for 12 units: 15 today vs **6** with × Qté |
| 4. Weighed 0.5 kg | 6 + typing, **and can't be entered correctly (C1)** | **4** (+1): tile, preset 0.5, Charge, Complete | −2, no keyboard, correct amount |
| 5. Credit sale, no-barcode item | 7 + typing | **5** (+1): tile, Charge, Pay later, customer, Complete | −2, no typing |

The payment part of scenario 5 doesn't change with the grid. With more than about 20 regulars, add a search field to the credit customer list (open question 11).

### 2.9 Build plan

Each step is one PR off `main` that's independently shippable and keeps `npm run check` green. Steps 0a–0d come first because they fix real money bugs regardless of the grid.

| Step | PR | Tests |
|---|---|---|
| **0a** | Fix the kg input (C1, C4): keep the raw text in local state and parse on blur/submit; new kg lines start empty and must be filled. | Add a pure `quantityInputState` helper to `tests/money` covering `"0."`, `"0,5"`, `".5"`, `"1.5"`, `"0.125"`, and empty. |
| **0b** | Reset `PaymentSheet` to cash, no customer and empty tendered every time it opens (C2). | Component test: credit sale, then reopen → method is cash and customerId is null. |
| **0c** | Exact barcode lookup online (C3): use `findByBarcode` semantics with the full row, falling back to "not found". | Unit test: code `1234` doesn't match `12345678` or a product named "Pack 1234". |
| **0d** | Translate `PaymentSheet`, `ContinuousScanner`, Stack titles and the `CartLineRow` unit label. Add `isolateBidi` on every product and customer name in the Sell flow. Make header links and "Retirer" 48 dp. | Extend `tests/i18n` with a check that the Sell-flow components have no raw English literals (a lint-style grep test). |
| **1** | Migration: `open_price`, the view append, `sell_grid_tabs`, `sell_grid_tiles`, RLS, `set_sell_grid_tiles`. | `supabase db reset` from scratch. New `tests/security/sellGridRls.live.test.ts`: cashier reads OK, cashier insert/update/delete refused, owner writes OK, no cost columns returned. Extend `cashierIsolation` with the new view column. |
| **2** | Data layer: `src/lib/sellGrid/queries.ts`, pure `src/lib/sellGrid/layout.ts` (`resolveGrid`), and cache v2 with the grid snapshot and extra product fields. | `tests/sellGrid/layout.test.ts` covers every row of the 2.6 table (inactive hidden, cascade, auto_fill order, empty tab hidden, stale product). Cache test: the serialized cache contains **no key matching `/cost/`**. v1 to v2 migration test. |
| **3** | Read-only grid on Sell: tabs, tiles, tap = add 1, ×N badge, phone and tablet layouts, compact cart lines, collapsible phone cart, swipe between tabs. FR/EN/AR keys. | Pure `addToCart(lines, product, qty, priceOverride?)` in `src/lib/sales/cart.ts` (money rule: tested) that merges lines, keeps `unit_cost_cents: null` from tiles, and passes an open price through. Pure `sellLayoutFor(width)` breakpoint test. |
| **4** | Pads: quantity, weight (with presets) and price pads, plus the × Qté multiplier, which also applies to the next scan. | Pure `keypadReducer` tests: decimal with `,` and `.`, max 3 decimals for kg, max digits, 0 blocked for price. Test that the multiplier applies once and then resets. |
| **5** | Owner edit mode: tabs CRUD and order, tile add/remove/reorder/color/short label, auto_fill toggle, "Remplir avec les meilleures ventes", offline lock. | Pure reorder helper tests. Live test: owner `set_sell_grid_tiles` is atomic (a bad payload leaves the old order intact). Hidden-for-cashier test via `useAuth` mock. |
| **6** | Product form: "Prix libre" checkbox and price-pad presets (owner only). | Form validation tests in the existing products tests. |
| **7** | Polish: haptics, empty states, a11y labels, RTL pass on device, a collapsible web sidebar below 900 dp, and a native HID scanner path (handle `onSubmitEditing` and keep a focused hidden input) if open question 12 is yes. | Manual RTL and device checklist, attached to the PR. |

Each PR is reviewed and merged before the next one starts, so `main` never holds half a grid. Steps 3–5 can sit behind a simple "grid configured?" check: with no tabs in the database, Sell renders exactly as today.

### 2.10 Open questions for you

These are business decisions. I've noted my recommendation where I have one.

1. **Favoris: picked by you, or automatic best sellers?** I recommend hand-picked, with the one-off "fill from best sellers" button. Automatic re-ranking moves tiles under the cashier's fingers.
2. **One grid for the whole shop?** I designed for one shared grid on every device. Does any device (for example a second counter) need a different set of tiles?
3. **Out-of-stock tiles:** sell normally with a "0" badge (as scanning does today), ask for confirmation, or block the sale?
4. **Open-price items:** which products (phone top-ups, loose bread, a generic "Divers" item)? Can a cashier type any price, or should you set a minimum and maximum per product?
5. **Weighed items:** weight only, or also "by amount" ("10 DH of olives" → the app computes the weight)?
6. **Category tabs:** show every active product in the category automatically, or only the ones you pick? (Both are designed via `auto_fill`; which should be the default?)
7. **Tile colors:** chosen per tile, or automatically by category?
8. **Size:** roughly how many tabs and tiles per tab do you expect? (This affects tile size and whether tabs need to scroll.)
9. **Product photos on tiles:** wanted later? (This needs image storage. It's not in this design.)
10. **Who can edit the grid:** owner only (as specified), or should a trusted cashier get a "manager" permission later?
11. **Credit customers:** how many regulars buy on credit? Past about 20, the payment sheet needs a customer search.
12. **Hardware:** will the counter use an Android tablet with a USB or Bluetooth scanner? If yes, the native scanner path (step 7) should move up, because today it needs a tap per scan on native.
