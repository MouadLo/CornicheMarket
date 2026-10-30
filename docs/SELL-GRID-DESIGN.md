# Sell screen: UX assessment and product grid design

Status: proposal with the owner's final decisions applied (section 2.0), no code written. Assessed against `main` at `4cddc78`.
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
- On Android or iOS with a **USB or Bluetooth (HID) scanner**, the keyboard-wedge hook is web-only (`useKeyboardWedge.ts:20`). Scans only land if the search field happens to have focus, Enter isn't handled, and each scan then needs a tap on the result. (Not a target any more: the owner chose camera-only scanning, see 2.0.)

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

### 2.0 Owner decisions (final)

These replace the open questions in the first version of this doc. Where a decision changed the design, the relevant section below says so.

| # | Decision | Effect on the design |
|---|---|---|
| 1 | **Favoris is hand-picked by the owner only.** An optional "suggest from best sellers" helper exists. No automatic reordering, ever. | 2.4: the helper only proposes; nothing is saved until the owner confirms. |
| 2 | **Out-of-stock tiles stay sellable** and show a small stock badge. Never blocked. | 2.2 and 2.6. Matches the existing rule that oversold stock is visible, not forbidden. |
| 3 | **No open-price flag.** Instead one built-in **"Divers"** item: a tile that opens the amount keypad and adds a "Divers" line, with an optional short note. No stock tracking. Cost is estimated from an owner-set default margin (marked "estimated" in reports) and Divers is reported as its own separate line, excluded from per-product margin rankings. Owner-set maximum amount per Divers line, default 200 DH. Every Divers line is written to an activity log with the cashier. | `open_price` is removed everywhere. New: 2.5 (Divers columns, settings, activity log), 2.6, 2.9 steps 1 and 6. |
| 4 | **Weighed items accept weight and "by amount"** (the cashier types DH and the app computes the weight to 3 decimals). | 2.3: the weight pad gets a Poids / Montant switch. |
| 5 | **Category tabs auto-fill** with the category's active products. The owner can hide, pin to the top and reorder products per tab. **Favoris is the only fully hand-picked tab.** | 2.4 and 2.5: `auto_fill` is the default for category tabs; tile rows are overrides (`hidden`, `pinned`, `position`). |
| 6 | **One grid per store**, the same on every device. Tile size and last open tab stay per device. | As already designed (2.5). |
| 7 | **The credit customer picker gets a search field**, regardless of how many customers there are. | New build step 0e. |
| 8 | **Hardware: an Android tablet (primary: grid and cart side by side) and a phone (secondary: grid dominant, collapsible cart). Camera scanning only, no USB or Bluetooth scanner.** The camera must stay open between scans, use the rear camera, beep and vibrate on each scan, and ignore the same code twice within 1 second. | 2.7 (tablet is the primary layout), new 2.7.1 scanner requirements, new build step S. The native HID scanner path is dropped from the plan. |
| 13 | **Divers margin starts at 20%, owner-editable** (Settings). | 2.5: `owner_settings.divers_margin_percent` default 20. |
| 14 | **Divers note is free text, 60 characters maximum.** | 2.3 and 2.5 (`sale_items.note`, CHECK length 60). No preset list. |
| 15 | **Divers is always the first tile in every tab.** | 2.4 and 2.6: `resolveGrid` puts it first on every tab; not editable. |
| 16 | **On the tablet the camera is a panel beside the cart, not full screen.** | 2.7.1: confirmed as designed. |
| 17 | **Voiding a sale that has a Divers line writes its own activity-log entry.** | 2.5 and 2.6: new `divers_void` action. |
| 9-12 | Remaining questions: **keep the recommendations** (tile colors per tile from the 8-color palette; tile size S/M/L per device; no product photos for now; only the owner edits the grid). | No change. |

### 2.1 Principles

1. **The grid is an addition.** Search and camera scan behave as today (the keyboard wedge stays for web, but no hardware scanner is planned). The camera scanner gets the upgrades in 2.7.1. Typing in search temporarily replaces the grid with results. Clearing the search brings the grid back on the same tab.
2. **Muscle memory beats cleverness.** Tiles don't move unless the owner moves them. Nothing re-sorts automatically under the cashier's thumb.
3. **No cost data, ever.** Grid tables hold no money columns. Tiles read name, price and unit from the cashier-safe product cache, and a tile never puts a cost into the cart (`unit_cost_cents: null`; the server stamps cost as it does today).
4. **Works offline.** The layout is cached with the products.

### 2.2 Tiles

```
┌────────────────┐   ┌────────────────┐   ┌────────────────┐   ┌────────────────┐
│ Pain rond      │   │ Tomates        │   │ Divers         │   │ Coca-Cola 33cl │
│            24  │   │             6  │   │                │   │       ×3    9  │ ← ×3 in cart, 9 in stock
│ 1.20 DH        │   │ 9.00 DH/kg  ⚖ │   │ Montant     ✎ │   │ 7.00 DH        │
└────────────────┘   └────────────────┘   └────────────────┘   └────────────────┘
   piece/pack           weighed             built-in Divers       in cart
```

- **Size.** At least 64 dp (the requirement), aiming for 88–104 dp on phones (3 columns at 360 dp width) and about 120 dp on tablets (5–6 columns). An optional per-device setting offers S, M or L.
- **Content.** The name takes up to 2 lines, is wrapped in `isolateBidi()`, and aligns to the start edge. The selling price is bold and always LTR-isolated. A small icon marks weighed (⚖) items and the built-in Divers tile (✎). A **"×N" badge** shows how many are already in the cart, so the cashier gets instant feedback without looking at the cart.
- **Stock badge.** A small number in the corner shows the stock on hand (from the product cache, so it can be stale offline). It turns amber at or below the low-stock threshold and red at 0 or below. The tile stays tappable in every case (decision 2). The Divers tile has no badge (no stock tracking). "Inactif" appears only in edit mode.
- **Color.** An optional choice from a fixed **8-color palette**, stored as a key such as `green` or `amber`. Free hex isn't offered. The palette guarantees readable text in light and dark mode, and the value can be validated with a CHECK constraint.
- **Accessibility label.** For example "Pain rond, 1.20 dirhams, 2 dans le panier".

### 2.3 Interactions

| Gesture | Piece or pack | Weighed (kg) | Divers |
|---|---|---|---|
| **Tap** | add 1 (haptic and flash on the tile) | open the **weight pad** | open the **amount pad** |
| **Long-press** (400 ms) | open the **quantity pad** | weight pad | amount pad |
| **× key, then tap** | add N | — | add N at the entered price |

- **Multiplier key "× Qté".** This is the visible, discoverable alternative to long-press, and a classic POS pattern: tap ×, type `6`, then tap a tile **or scan a barcode**, which adds 6. It also removes the 11-tap problem for scanned items.
- **Pads are custom on-screen keypads, not the OS keyboard.** They avoid the C1 decimal bug entirely: the pad keeps the raw string and parses once on OK. They don't cover the screen and work the same on every platform.

```
 Weight pad (bottom sheet)              Quantity pad                  Amount pad (Divers)
┌──────────────────────────────┐   ┌────────────────────────┐   ┌────────────────────────┐
│ Tomates · 9.00 DH/kg         │   │ Coca-Cola 33cl         │   │ Divers                 │
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
- **Weight or amount (decision 4).** The weight pad has a **Poids | Montant** switch. In Montant mode the cashier types DH (for example 10.00 for olives at 40.00 DH/kg) and the app shows and adds the computed weight, rounded to 3 decimals (0.250 kg). The line total is then recomputed from the rounded weight, so it can differ from the typed amount by a few centimes (10.00 DH at 30.00 DH/kg is 0.333 kg = 9.99 DH); the pad shows the actual total before adding. The same pure function converts in both directions and is tested.
- **Divers amount pad.** Opens on tile tap. The cashier types an amount (up to the owner's maximum, default 200 DH, enforced on the pad and again by the server), optionally taps "Note" for a short text (up to 60 characters), and adds. Quantity is always 1. Divers has no presets.
- **Physical keyboard on web.** All pads also accept the keyboard (digits, decimal point, Backspace, Enter), which a tablet with a keyboard dock or the web register can use.
- The pad keys are 64 dp and laid out like a phone keypad, which RTL doesn't mirror.

### 2.4 Owner-only "Edit grid" mode

Entered with a "Modifier la grille" button that only owners see (the role comes from `useAuth()` as everywhere else). Cashiers never see the button, and RLS refuses their writes anyway.

In edit mode:

- **Tabs:** add a tab (pick a category, or "Favoris"), rename the display label, hide or show, drag to reorder, delete. A category tab **auto-fills** with all of that category's active products (decision 5), so a new product appears on its tab without any setup.
- **Products on a category tab:** the owner can **hide** a product from the tab, **pin** it to the top, and **reorder** the products. Order on a tab is: pinned products (in the owner's order), then products the owner has placed (in the owner's order), then everything else alphabetically by name. The alphabetical tail is deterministic, so nothing shuffles under the cashier's thumb.
- **Favoris** is the only fully hand-picked tab: only products the owner adds appear there, in the owner's order. "+ Ajouter" opens the existing product search picker (reusing `ProductSearchPicker`). Tapping a tile sets its color or short label, or removes it.
- **"Suggérer les meilleures ventes"** (optional helper, decision 1) shows the top 24 products by quantity over 30 days, using the existing `report_product_performance` RPC, as a checklist. Nothing is added until the owner confirms, and it never runs on its own or reorders anything.
- **Divers** is a built-in product that is **always the first tile of every tab** (Favoris and every category tab), in a fixed position the owner can't move, hide, pin or remove. It can't be deleted or deactivated either. Its two settings live in Settings, owner only: the **maximum amount per line** (default 200.00 DH) and the **default margin %** used to estimate its cost (see 2.5).
- **Saving needs a connection.** Edits are written straight to the server, with no offline edit queue. Offline, edit mode shows "Connexion requise pour modifier la grille." Every save refreshes the local cache.
- Inactive products stay visible here, greyed out with an "Inactif" badge, so the owner can clean them up.

### 2.5 Data model

New **additive** migration, using whatever number is next free at merge time. There are three Codex branches in flight (`codex/t01…t03`) that may also add migrations, so the filename shouldn't be picked until rebase.

```sql
-- Decision 3: no open_price flag. One built-in "Divers" product instead.
alter table products add column kind text not null default 'regular'
  check (kind in ('regular', 'misc'));
alter table products add column track_stock boolean not null default true;
create unique index one_misc_product on products (kind) where kind = 'misc';
insert into products (name, kind, track_stock, selling_price_cents, unit)
  values ('Divers', 'misc', false, 0, 'piece');
-- A trigger refuses to deactivate or delete the misc product.
-- apply_sale_item_stock skips products with track_stock = false.

-- create or replace view can only APPEND columns: kind, track_stock go last.
create or replace view products_cashier_view as
select id, name, barcode, category_id, unit,
       selling_price_cents, stock_quantity, low_stock_threshold, active,
       created_at, updated_at, is_low_stock,
       kind, track_stock
from products;

-- Divers lines: optional note, and a flag for a cost that is an estimate.
alter table sale_items add column note text check (char_length(note) <= 60);
alter table sale_items add column cost_estimated boolean not null default false;
-- trg_sale_items_before_insert (it already stamps unit_cost_cents server-side):
-- for kind = 'misc' it stamps round(unit_price * (1 - divers_margin_percent/100))
-- and cost_estimated = true. The client never sets either.

-- The max amount is not secret (the pad needs it), so it goes in the existing
-- singleton row, which every signed-in user can read.
alter table store_settings
  add column divers_max_cents bigint not null default 20000
    check (divers_max_cents > 0);                       -- 200.00 DH
-- The margin IS cost information, and store_settings is readable by cashiers,
-- so it lives in its own owner-only singleton table.
create table owner_settings (
  singleton              boolean primary key default true check (singleton),
  divers_margin_percent  numeric(5,2) not null default 20
    check (divers_margin_percent between 0 and 95)      -- placeholder, owner sets it
);
insert into owner_settings (singleton) values (true);
alter table owner_settings enable row level security;
create policy "owner reads owner settings"   on owner_settings for select using (public.is_owner());
create policy "owner updates owner settings" on owner_settings for update using (public.is_owner()) with check (public.is_owner());
-- record_sale rejects a Divers line above divers_max_cents, or with quantity <> 1.
-- The cost trigger reads owner_settings as security definer, so cashiers' sales still get a cost.

-- Every Divers line is logged with the cashier. There is no activity log
-- today, so this is a new, owner-readable, append-only table.
create table activity_log (
  id          uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id    uuid not null references profiles (id),
  action      text not null,                 -- 'divers_sale' | 'divers_void'
  entity_id   uuid,                          -- the sale_items row
  details     jsonb not null default '{}'    -- {sale_id, amount_cents, note, cost_estimated}
);
alter table activity_log enable row level security;
create policy "owner reads activity log" on activity_log for select using (public.is_owner());
-- No insert/update/delete policy: rows are written only by security-definer
-- triggers: after insert on sale_items (misc lines -> 'divers_sale'), and
-- when a sale gets voided_at set, one 'divers_void' row per Divers line on
-- it, with the voiding user as actor and the original cashier + void
-- reason in details.

create table sell_grid_tabs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('favorites', 'category')),
  category_id uuid references categories (id) on delete cascade,
  label       text,                 -- null = category name, or translated "Favoris"
  position    integer not null,
  visible     boolean not null default true,
  auto_fill   boolean not null default true,   -- category tabs auto-fill (decision 5)
  updated_at  timestamptz not null default now(),
  constraint tab_kind_matches_category
    check ((kind = 'category') = (category_id is not null)),
  constraint favorites_never_auto_fill
    check (kind = 'category' or auto_fill = false)
);
create unique index sell_grid_one_favorites on sell_grid_tabs (kind) where kind = 'favorites';
create unique index sell_grid_one_tab_per_category on sell_grid_tabs (category_id) where category_id is not null;

-- On Favoris a row means "this product is on the tab". On an auto-filled
-- category tab a row is an OVERRIDE of the automatic list (hide, pin, order).
create table sell_grid_tiles (
  id          uuid primary key default gen_random_uuid(),
  tab_id      uuid not null references sell_grid_tabs (id) on delete cascade,
  product_id  uuid not null references products (id) on delete cascade,
  position    integer not null,
  hidden      boolean not null default false,   -- category tabs only: suppress this product
  pinned      boolean not null default false,   -- category tabs only: sort to the top
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

-- Atomic "replace this tab's overrides in this order" so a reorder never
-- leaves half-written positions. security invoker: RLS above still applies.
create function public.set_sell_grid_tiles(p_tab_id uuid, p_tiles jsonb) returns void ...
```

**Reports for Divers.** `sale_line_economics` gets two trailing columns (`is_misc`, `cost_estimated`; append only). `report_product_performance` excludes Divers, so it never appears in the per-product margin rankings (top by profit, lowest margin). A new `report_divers(p_from, p_to)` returns count, revenue, estimated cost and estimated profit for the period, shown on the Reports screen as its own line labelled "estimé". The headline revenue, cost and profit in `report_summary` still include Divers (it is real money), with the Divers share and an "estimated" marker shown beneath so the owner knows part of the cost is not a purchase cost.

**Cost is never visible to cashiers.** The margin lives in `owner_settings` (owner-only RLS) and the estimated cost in `sale_items`, which cashiers can't read. A cashier can read only `store_settings.divers_max_cents`, which the pad needs and which isn't cost information. (Putting the margin in `store_settings` would have leaked it: that table is readable by every signed-in user.)

**Per store, not per device.** The layout lives in the database and every device in the shop reads the same grid. Reasons:

- The owner configures it **once**, and the counter tablet, a backup phone and the web register all match. A cashier switching devices finds tiles in the same places.
- It survives reinstalls, a lost phone and a new tablet. A per-device layout lives in AsyncStorage and is gone with the device.
- Cashiers can't edit the grid, so per-device customization would only help the owner, who sets things up on one device anyway.
- It follows the existing `store_settings` singleton pattern: one store, one configuration. If the app ever goes multi-store, add `store_id` to both tables.

Display preferences that really are per device stay local in AsyncStorage: tile size (S/M/L), last selected tab, and whether the phone cart is expanded.

**Offline cache.** Bump the cache key to `corniche.productCache.v2` and store one snapshot:

```ts
type ProductCache = {
  products: CachedProduct[];           // + category_id, stock_quantity, kind, track_stock (still NO cost)
  grid: { tabs: GridTab[]; tiles: GridTile[] };
  diversMaxCents: number;              // the pad's limit; the server re-checks
  refreshedAt: string;
};
```

It's refreshed by the same "came online" trigger as today and after every owner save. A pure function `resolveGrid(tabs, tiles, products)` turns the snapshot into what's on screen. That one function owns every edge case in 2.6 and the tab ordering rule in 2.4, which makes it straightforward to test.

### 2.6 Edge cases

| Situation | Cashier sees | Owner in edit mode sees | Data |
|---|---|---|---|
| **Product deactivated** | The tile is **hidden**, because the cache only holds active products and you can't sell an inactive one. | A greyed tile with an "Inactif" badge and a remove button. | The tile row is **kept**, so reactivating restores it in the same place. |
| **Product deleted** | Gone. | Gone. | `on delete cascade` removes its tiles. (Sold products can't be hard-deleted anyway, because `sale_items` references them.) |
| **Category deleted** | Its tab disappears. | Same. | The tab and its tiles cascade. Favoris tiles for those products remain. |
| **Product moved to another category** | It leaves the old category tab and appears on the new one automatically. Its hide/pin/position overrides belong to the old tab and no longer apply; on Favoris it stays where the owner put it. | Same. | No change. |
| **No stock** (≤ 0) | The tile is **still tappable** (decision 2), with a red stock badge showing 0 or the negative number. Scanning allows overselling today and the app already reports negative stock, so the grid doesn't make it stricter. It's never blocked and never asks for confirmation. | Same, plus the low-stock color. | Stock comes from the cache and can be stale offline, just like prices today. |
| **Price changed** | The tile shows the new price after the next cache refresh. | Same. | Same staleness rules as scanning today. |
| **Product created after the last refresh, while offline** | The tile is hidden until the next refresh. | The edit button is disabled while offline. | No change. |
| **Divers amount is 0, empty, or above the maximum** | The amount pad blocks "Ajouter" and shows the limit (default 200.00 DH). | — | The server enforces the same limit in `record_sale`. If the owner lowers the limit while a device is offline with the old value, the sale is rejected on sync and lands in the stuck-sales list like any other rejected sale. |
| **Divers line sold** | Appears in the cart as "Divers" with its note. No stock, no barcode. | The sale shows in the activity log with the cashier, amount and note, and in the Reports "Divers" line (cost marked estimated). | One `activity_log` row per Divers line. Voiding the sale keeps the original `divers_sale` row and adds a `divers_void` row (voiding user as actor, plus the original cashier, amount and the void reason). |
| **Divers tile position** | Always the first tile of every tab, including auto-filled category tabs and Favoris, regardless of pins or order. | In edit mode it is shown first with a lock icon and has no hide, pin, move or remove controls. | `resolveGrid` inserts it first; no tile row is stored for it. |
| **Owner tries to deactivate or delete Divers** | — | Refused with an explanation. | A trigger on `products` enforces it. |
| **Weighed "by amount" gives a weight that rounds to 0.000** | The pad blocks Add (a 0.01 DH amount on an expensive item). | Same. | Weight must be at least 0.001 kg. |
| **Empty tab, or no grid configured yet** | The tab is hidden. With no tabs at all, Sell looks like today plus a hint that the owner can set up the grid. | An "Ajouter des produits" call to action. | — |

### 2.7 Screen layouts

The **Android tablet is the primary device** (decision 8) and the **phone is secondary**. Tablet layout is therefore the reference design; the phone layout below is the compact variant.

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

#### 2.7.1 Camera scanner requirements (decision 8)

There is no USB or Bluetooth scanner, so the camera is the only scanner and has to be fast. Against today's `ContinuousScanner`:

| Requirement | Today | Change |
|---|---|---|
| Stays open between scans | Yes (it's a modal that only closes on Done) | Keep. On tablet, show it as a camera panel next to the cart instead of a full-screen modal, so the cashier sees the cart grow while scanning. |
| Rear camera | `CameraView` has no `facing`, and the default is the **back** camera on most devices, but this isn't guaranteed on tablets | Set `facing="back"` explicitly. |
| Beep and vibrate on each accepted scan | None | Play a short sound (`expo-av` or `expo-audio` with a bundled asset) and vibrate (`Vibration.vibrate(40)`). A different, longer pattern for "unknown barcode". Both are skipped for a scan that was ignored as a duplicate. |
| Ignore the same code twice within 1 second | 1.5 seconds (`RESCAN_DELAY_MS = 1500`) | Set to 1000 ms. A pure `shouldAcceptScan(last, code, now)` function holds the rule so it's unit-tested. The same code after 1 second counts as a second item, which is how a cashier scans two identical items. |
| Product with a weight (kg) scanned | Not handled by the camera modal | The weight pad opens over the camera panel (today it closes the camera to avoid stacking modals; the panel layout on tablet removes that problem). |

**Compact cart lines.** Each line becomes a single 56 dp row (name, quantity control, total). Discount and remove move behind a tap on the line. This alone roughly doubles how many lines fit on a phone.

### 2.8 Tap counts: today vs. with the grid

Same rules as 1.2. "+1" is a tab switch when the item isn't on the open tab. The after column assumes the C1–C4 fixes.

| Scenario | Today | With grid | Change |
|---|---|---|---|
| 1. Scanned item (phone camera) | 4 | 4 (scan is unchanged), or **3** if it's a tile | −1 for tiled items |
| 1b. Scanned item (web, keyboard-wedge) | 2 | 2 | unchanged. Not a target device (decision 8), kept as is. |
| 2. Item with no barcode | 5 + typing + network wait | **3** (+1) | −2 taps, **no typing**, instant offline |
| 3. Three of the same | 6 (barcoded) / 7 + typing | **5** (+1): tile ×3, Charge, Complete | −1 / −2; for 12 units: 15 today vs **6** with × Qté |
| 4. Weighed 0.5 kg | 6 + typing, **and can't be entered correctly (C1)** | **4** (+1): tile, preset 0.5, Charge, Complete | −2, no keyboard, correct amount |
| 4b. 10 DH of olives (by amount) | not possible | **5** (+1): tile, Montant, type `1` `0` (2 key taps), Add, then Charge, Complete = 7 | new capability; no scale arithmetic by the cashier |
| 5. Credit sale, no-barcode item | 7 + typing | **5** (+1): tile, Charge, Pay later, customer, Complete (search optional) | −2, no typing |
| 6. Divers: 12 DH, no note | no way to ring it up except an existing product at the wrong price | **7** (+1): Divers tile, `1` `2`, Add, Charge, Complete (4 + 2 key taps) | new; adds a note with 1 more tap and short typing |

The payment part of scenario 5 doesn't change with the grid, except that the customer picker gets a search field (decision 7, step 0e), so with many regulars it stays a type-and-tap, not a scroll.

### 2.9 Build plan

Each step is one PR off `main` that's independently shippable and keeps `npm run check` green. Steps 0a–0e come first because they fix real money bugs or are independent of the grid, and step S (the scanner) is independent too.

| Step | PR | Tests |
|---|---|---|
| **0a** | Fix the kg input (C1, C4): keep the raw text in local state and parse on blur/submit; new kg lines start empty and must be filled. | Add a pure `quantityInputState` helper to `tests/money` covering `"0."`, `"0,5"`, `".5"`, `"1.5"`, `"0.125"`, and empty. |
| **0b** | Reset `PaymentSheet` to cash, no customer and empty tendered every time it opens (C2). | Component test: credit sale, then reopen → method is cash and customerId is null. |
| **0c** | Exact barcode lookup online (C3): use `findByBarcode` semantics with the full row, falling back to "not found". | Unit test: code `1234` doesn't match `12345678` or a product named "Pack 1234". |
| **0d** | Translate `PaymentSheet`, `ContinuousScanner`, Stack titles and the `CartLineRow` unit label. Add `isolateBidi` on every product and customer name in the Sell flow. Make header links and "Retirer" 48 dp. | Extend `tests/i18n` with a check that the Sell-flow components have no raw English literals (a lint-style grep test). |
| **0e** | Customer search in the payment sheet's credit picker (decision 7): a search field filtering the chips by name, accent- and case-insensitive. | Pure `filterCustomers(list, query)` tests (accents, Arabic, empty query returns all). Sheet test: typing narrows the chips. |
| **S** | Camera scanner upgrades (2.7.1): `facing="back"`, beep and vibrate on accepted scans, 1000 ms duplicate window. Independent of the grid, so it can ship first. | Pure `shouldAcceptScan` tests (same code at 999 ms ignored, at 1000 ms accepted, different code accepted immediately). Component test with mocked sound/vibration: one beep and one vibration per accepted scan, none for a duplicate. Device check on the tablet and phone. |
| **1** | Migration: `kind`/`track_stock` on products (and the Divers row), the view append, `sale_items.note`/`cost_estimated`, the stock and cost triggers for Divers, `store_settings.divers_max_cents`, the owner-only `owner_settings` (margin), `activity_log` with its trigger, `sell_grid_tabs`, `sell_grid_tiles`, RLS, `set_sell_grid_tiles`. No `open_price`. | `supabase db reset` from scratch. New live tests: grid RLS (cashier reads, writes refused, owner writes; no cost columns); a Divers sale does not change stock, stamps an estimated cost from the margin, is refused above the max or with quantity 2, and writes one `divers_sale` activity-log row with the cashier; voiding that sale writes one `divers_void` row; cashier can't read `activity_log` or `owner_settings`; the Divers product can't be deactivated or deleted. Extend `cashierIsolation` with the new view columns. |
| **2** | Data layer: `src/lib/sellGrid/queries.ts`, pure `src/lib/sellGrid/layout.ts` (`resolveGrid`, including the pinned / placed / alphabetical order and hidden products), and cache v2 with the grid snapshot, Divers limit and extra product fields. | `tests/sellGrid/layout.test.ts` covers every row of the 2.6 table (Divers first on every tab even with pins and on an empty tab; inactive hidden, cascade, auto_fill order, hidden and pinned overrides, Favoris is curated only, empty tab hidden, stale product). Cache test: the serialized cache contains **no key matching `/cost/`**. v1 to v2 migration test. |
| **3** | Read-only grid on Sell: tabs, tiles, tap = add 1, ×N badge, phone and tablet layouts, compact cart lines, collapsible phone cart, swipe between tabs. FR/EN/AR keys. | Pure `addToCart(lines, product, qty)` in `src/lib/sales/cart.ts` (money rule: tested) that merges lines, keeps `unit_cost_cents: null` from tiles, and never merges Divers lines (each is its own line with its own note). Stock badge thresholds as a pure function. Pure `sellLayoutFor(width)` breakpoint test. |
| **4** | Pads: quantity pad, weight pad with the Poids / Montant switch and presets, and the Divers amount pad (max amount, optional note), plus the × Qté multiplier, which also applies to the next scan. | Pure `weightFromAmount` / `amountFromWeight` tests (rounding to 3 decimals, 0.001 kg minimum, the 10 DH at 30 DH/kg = 0.333 kg = 9.99 DH case). Keypad reducer tests (decimal with `,` and `.`, max digits, 0 blocked, Divers max). Divers line: quantity 1, note 60 characters. Test that the multiplier applies once and then resets. |
| **5** | Owner edit mode: tabs CRUD and order, tile add/remove/reorder/color/short label, auto_fill toggle, "Remplir avec les meilleures ventes", offline lock. | Pure reorder helper tests. Live test: owner `set_sell_grid_tiles` is atomic (a bad payload leaves the old order intact). Hidden-for-cashier test via `useAuth` mock. |
| **6** | Divers in Settings and Reports (owner only): maximum amount and default margin settings, the Reports "Divers" line marked estimated, Divers excluded from the per-product rankings, and an activity-log screen (or a filtered view) showing Divers lines with the cashier. | Reports math tests (Divers excluded from rankings and shown separately, cost marked estimated). Settings validation tests (max above 0, margin 0-95, default 20). Live test: `report_product_performance` never returns the Divers product. |
| **7** | Polish: haptics, empty states, a11y labels, RTL pass on the tablet and phone, the tablet camera panel, and a collapsible web sidebar below 900 dp. (The native HID scanner path is dropped: decision 8.) | Manual RTL and device checklist, attached to the PR. |

Each PR is reviewed and merged before the next one starts, so `main` never holds half a grid. Steps 3–5 can sit behind a simple "grid configured?" check: with no tabs in the database, Sell renders exactly as today.

### 2.10 Decisions recorded, and what is still open

All 12 original questions and the 5 follow-up questions are answered (section 2.0, decisions 1-17). Nothing is open. If a new question comes up while building, it is added here.
