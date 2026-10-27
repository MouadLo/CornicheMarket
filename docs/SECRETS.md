# GitHub Secrets & Environment Configuration

This document lists every secret required to deploy Corniche Market. Corniche Market uses **one Supabase project** (no staging/production split) and deploys to Vercel for web and EAS for mobile.

Set these secrets in **GitHub → Settings → Secrets and variables → Actions** (no environment restriction — they apply to all workflows).

## Required secrets (single project)

| Secret | What it is | Where to get it |
|--------|-----------|-----------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Your Supabase project URL | [Supabase dashboard](https://supabase.com/dashboard) → your project → Settings → API → Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key | Same location → `anon` key (public, safe to commit to environment variables) |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI personal token | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) → Generate new token |
| `SUPABASE_PROJECT_REF` | Your project reference ID | Settings → General → Reference ID (20-char string) |
| `SUPABASE_DB_PASSWORD` | Your database password | Settings → Database → Database password (what you set when creating the project) |
| `VERCEL_TOKEN` | Vercel API token | [vercel.com/account/tokens](https://vercel.com/account/tokens) → Create Token (scope: `full`) |
| `VERCEL_ORG_ID` | Your Vercel org/personal ID | After running `npx vercel link` locally, read from `.vercel/project.json` → `orgId`, OR dashboard → Settings → General → Team ID |
| `VERCEL_PROJECT_ID` | Your Vercel project ID | Same as above → `projectId` in `.vercel/project.json`, OR from dashboard |
| `EXPO_TOKEN` | Expo/EAS authentication token | [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens) → Create Token |

## How to add secrets to GitHub

1. Go to **GitHub → Settings → Secrets and variables → Actions**.
2. Click **New repository secret** (not environment-specific).
3. Add each secret from the table above.

## How to find VERCEL_ORG_ID and VERCEL_PROJECT_ID

Run locally:
```bash
npx vercel link
```

This creates `.vercel/project.json` containing `orgId` and `projectId`. Copy them to GitHub:
```bash
cat .vercel/project.json  # shows orgId and projectId
```

Add `.vercel/` to `.gitignore` so credentials are not committed.

---

## Local development (`.env.local`)

You do not need a `.env.local` file to run the app locally with `npm run start`. The Supabase client reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from the environment automatically. If you want to override them locally:

```bash
export EXPO_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="eyJhbGc..."
npm run start
```

**Never commit `.env.local` or any file with real secrets.**
