# Corniche Market — Convenience Store App

See [AGENTS.md](AGENTS.md) for Expo/React Native conventions (routing, commands, EAS). This file is the product/business spec.

## Goal
Track every product's buying price (cost) and selling price, record sales, and show profit per product, per day and per month. The store has thousands of items, so speed of entry and search is critical.

## Platforms
One codebase that runs on Android, iOS and web: Expo (React Native) with Expo Router and TypeScript. Backend: Supabase (Postgres, Auth, Row Level Security).

## Users
- **Owner**: full access, sees costs and profit.
- **Cashier**: can make sales and receive stock but CANNOT see buying prices or profit.

## Core Features
1. **Product catalog**: name, barcode, category, unit (piece, kg, pack), selling price, current cost, stock quantity, low-stock threshold, active/inactive.
2. **Purchases (stock in)**: record supplier deliveries with the buying price per item. Buying prices change over time, so keep full cost history.
3. **Sales (checkout)**: fast barcode scan or search, cart, quantity, discounts, payment method (cash/card/credit), receipt summary.
4. **Profit**: each sale line stores the cost at the time of sale, so historical profit stays correct when prices change. Use weighted average cost.
5. **Inventory**: stock auto-decreases on sale and increases on purchase; manual adjustments with a reason (damaged, expired, theft, count correction).
6. **Reports**: daily/weekly/monthly sales, profit, margin %, best and worst sellers, slow-moving items, low stock.
7. **Bulk import/export** of products via CSV/Excel.

## Requirements
- **Currency**: Moroccan Dirham (MAD), 2 decimals. Store money as integers (centimes) in the database.
- **Languages**: French, Arabic (with right-to-left support), and English. French as the primary/default language.
- Search must stay fast with 10,000+ products.
- Sales must work offline on mobile and sync when back online.
- Simple, large-button UI usable at a busy counter.

## Working Rules
- Build in phases; one phase at a time, given by the user.
- After each phase: run the app, fix errors, write tests for any money/stock calculations, and summarize what to test manually.
- Ask before adding paid services or big dependencies.
- Don't add features, abstractions, or error handling beyond what the current phase requires.
- Default to no comments in code; only comment non-obvious WHY (e.g. weighted-average-cost math, offline-sync conflict handling).

## Database Schema (Phase 1)
Supabase Postgres, migrations in `supabase/migrations/`. Tables: `profiles` (role: owner/cashier), `categories`, `suppliers`, `products`, `cost_history`, `purchases`, `purchase_items`, `sales`, `sale_items`, `stock_adjustments`.

- Money columns are `bigint` cents (centimes). Quantities are `numeric(12,3)` to support fractional kg.
- Stock and weighted-average cost only ever change through DB triggers (`apply_purchase_item`, `apply_sale_item_stock`, `apply_stock_adjustment`) — never update `products.stock_quantity` or `current_cost_cents` directly from the app.
- `sale_items.unit_cost_cents` is stamped server-side from the product's current cost by a `before insert` trigger; the client never supplies it.
- Cashiers cannot read any cost/profit column at the DB level (RLS + column-excluding views: `products_cashier_view`, `sale_items_cashier_view`). The app must query these views for cashier-facing screens, not the base tables.
