# Loyalty points (cardless)

The customer's **Moroccan mobile number is the card**. No app, no plastic.

Owner decisions (2026-11-20):
- Points. **1 point per full 10.00 DH** paid on eligible items; **100 points = 10.00 DH** (1 point = 0.10 DH, so 1 % back).
- The owner can **exclude** products and whole categories. Divers (the free-amount item, `kind = 'misc'`) never earns and can never be paid with points.
- **Proof when spending points**: the customer shows the QR of their digital card (this PR), or reads back an SMS code (later PR, needs an SMS provider account).

## Principles (same as the rest of the money path)
- Points are computed **on the server** from stamped sale lines, never sent by the device.
- Every change is a row in `loyalty_ledger`; a balance is `sum(points)`. Nothing is ever edited or deleted.
- The **device enforces, the server flags**. `record_sale` must never fail because of loyalty: an offline sale that cannot be un-rung must not block the queue. A redemption that the server cannot confirm (no proof, too many points, member unknown) is still recorded, the sale gets `needs_loyalty_review = true` and an `activity_log` row, exactly like the discount and credit reviews.
- Spending points is a **discount**: its value is part of `sales.discount_cents`, and `sales.loyalty_discount_cents` says how much of it was points. Reports, receipts, the discount allocation (`sale_line_economics`) and return refunds therefore stay right with no change: a return refunds what the customer paid in money, never the points part. The cashier discount limit and the discount review must **not** count the points part.
- Earning works offline: the device may send the member's phone instead of a customer id; the server resolves it when the sale syncs. **Spending needs a connection** (balance and proof are checked first).
- Cashiers never see cost or profit; nothing here exposes them.

## Database (migration `20260101000048_loyalty_points.sql`)
- `store_settings`: `loyalty_enabled` (default false), `loyalty_cents_per_point` (1000), `loyalty_point_value_cents` (10), `loyalty_min_redeem_points` (100), `loyalty_daily_review_points` (100: more points than this earned by one customer in one store day flags the sale for review).
- `products.loyalty_excluded`, `categories.loyalty_excluded` (default false, owner writes only). A main category's exclusion covers its sub-categories. Both flags and the bonus fields below are in `products_cashier_view` (not cost data).
- **Bonus points per product** (supplier-funded promos): `products.loyalty_bonus_points` (0..10000, per unit) and `products.loyalty_bonus_until` (null = no end). A line earns `floor(quantity) x bonus` (0.750 kg earns none, 2.4 kg earns 2x), only while `sale.occurred_at < until`, never on an excluded product or Divers (exclusion wins). The bonus is part of the sale's single `earn` row; `loyalty_ledger.bonus_points` says how much of it is bonus (also on the `sale_adjust` delta of a return).
- **Stamps at sale time**: `sale_items.loyalty_eligible` and `loyalty_bonus_per_unit` are stamped by a BEFORE INSERT trigger (never from the payload), and `sales.loyalty_cents_per_point` by `record_sale` when the sale earns. Earning and `loyalty_resync_sale` read only these stamps, so changing exclusions, bonuses or rates later never changes what a return or void reverses.
- `customers`: `phone_e164` (unique, `^\+212[5-7][0-9]{8}$`), `loyalty_joined_at`, `loyalty_consent_at`, `card_token` (unique, 128-bit random, base64url). A member = `loyalty_joined_at is not null`.
- `sales`: `loyalty_points_redeemed int >= 0`, `loyalty_discount_cents bigint >= 0, <= discount_cents`, `needs_loyalty_review boolean`.
- `loyalty_ledger(id, customer_id, sale_id, return_id, kind, points <> 0, created_by, created_at, note)` with kind in `earn | redeem | sale_adjust | adjust`. RLS: owner reads all; no direct writes by anyone.
- `loyalty_resync_sale(sale_id)` (internal): computes what the sale SHOULD have earned and SHOULD still hold as redeemed given its current state (voided, returns), compares with the ledger rows already written for that sale, and writes one `sale_adjust` delta row if they differ. Called after returns (statement trigger on `sale_return_items`) and when a sale is voided (trigger on `sales.voided_at`). Idempotent.
  - earned target = `floor(eligible_paid_remaining / stamped cents_per_point) + sum(floor(remaining_quantity) x stamped bonus)`; eligible paid = `sale_line_economics` paid amount of non-excluded, non-misc lines, minus the refunds of those lines; 0 for a voided sale.
  - redeemed target = redeemed points × (sale discount carried by the units kept / sale discount of the whole sale), rounded down in the customer's favour; points come back only for returned units they paid for, never for an item paid in money; 0 kept for a voided sale (all points come back).
- Spending cap: points pay only for lines that earn points AND take a sale discount (the discountable lines, or every line when none is), and never more than those lines have left after the manual sale discount. Points are part of `discount_cents`, which `sale_line_economics` spreads over exactly those lines: a larger claim would give a line a negative share and a return would refund money that was paid with points. A product the owner marked "no discount" therefore cannot be paid with points either.
- `record_sale` gets `p_loyalty jsonb default null`: `{customer_id?, phone?, redeem_points?, card_token?}`. The 7-argument version is dropped and recreated with the 8th argument defaulted (two overloads would be ambiguous through PostgREST), grants re-applied; old queued payloads without `p_loyalty` still work. New blocks, each in its own `begin … exception` like the others, never failing the sale: resolve the member (customer_id or phone), sales.customer_id set to the member when the sale had none, redemption checks (enabled, member, proof token matches, points >= min, <= balance (row locked), value <= eligible amount, `p_discount_cents >= value`), ledger `redeem`, ledger `earn`, daily review flag.
- RPCs (staff unless said): `loyalty_lookup(phone)`, `loyalty_join(phone, name, consent)` (creates or links the customer, issues the card token), `loyalty_card_customer(token)` (a scanned QR → member + balance; this is the proof), `loyalty_check_redeem(customer_id, points, token)` (what the device asks before payment), `loyalty_card(token)` (**anon**: first name, balance, value, recent history; nothing else), owner only: `loyalty_adjust(customer_id, points, note)`, `loyalty_reset_card(customer_id)`, `report_loyalty(from, to)` (also `points_bonus`, `top_bonus_products`), `loyalty_member_details(customer_id)`, `loyalty_balances()`. `customers.card_token` / `phone_e164` are not readable through the table by anyone (column-level grants).

## App
- `src/lib/loyalty/`: `phone.ts` (normalise `06…`, `07…`, `05…`, `+212…`, `00212…`, `212…` to `+212XXXXXXXXX`), `points.ts` (earn, value, max redeemable), `queries.ts`, card-QR recognition (the QR holds the card URL `…/card/<token>`).
- Sell: attach a member by phone (numeric keypad) or by scanning their card QR; join in one step (name optional, consent tick); share the card link by WhatsApp (`wa.me`, free).
- Spending (PR 2): in the payment sheet, with the card QR scanned as proof.
- Receipt: points discount line, points earned and balance.
- Public card page `/card/<token>`: balance, value in DH, QR to show at the counter. No login.
- Owner: Settings → Fidélité (on/off, rates, excluded categories); product form toggle; Clients shows member, balance and history; Reports gets a loyalty card.
- Scanner reads QR codes (card), accepted on one read (QR carries its own error correction).

## Legal note
Phone numbers are personal data (Moroccan law 09-08): consent is asked and stored at joining (`loyalty_consent_at`). A declaration to the CNDP may be needed; that is the owner's to check.
