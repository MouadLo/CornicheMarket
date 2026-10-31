# Efficiency timing harness

Reproduces the measurements in `docs/EFFICIENCY-PLAN.md` §1. Local Supabase only (seed accounts).

1. `npx supabase db reset` (seed data), then build the web app against local Supabase:
   `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon> npx expo export -p web --output-dir /tmp/eff-dist`
2. `node serve.cjs` (gzipped static server on :8120, SPA fallback).
3. With Playwright installed: `node startup.cjs`, and `VP=tablet node jobs.cjs` / `VP=phone node jobs.cjs`, optionally `PROF=tablet` for the throttled tablet profile (4x CPU, 4G 70 ms).

`jobs.cjs` writes sales, a payment, a delivery and a product into the local database each run.
