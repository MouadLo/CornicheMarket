# GitHub Secrets & Environment Configuration

This document lists every secret required to deploy Corniche Market. Set these in **GitHub → Settings → Secrets and variables → Actions** under the `staging` and `production` environments.

## Environment setup

Create two environments in GitHub (Settings → Environments):
- **`staging`**: used by CI/CD to deploy to staging Supabase and Vercel preview
- **`production`**: used by release workflows to deploy to production Supabase and Play Store

---

## `staging` environment secrets

| Secret | What it is | Where to get it |
|--------|-----------|-----------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Staging Supabase project URL | [Supabase dashboard](https://supabase.com/dashboard) → your staging project → Settings → API → Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Staging Supabase anon key | Same location → copy the `anon` key |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI personal token | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) → Generate new token (save it securely) |
| `SUPABASE_STAGING_PROJECT_REF` | Staging project reference ID | Settings → General → Reference ID (20-char string like `abcdefghijklmnopqrst`) |
| `SUPABASE_STAGING_DB_PASSWORD` | Staging database password | Settings → Database → Database password (or what you set when creating the project) |
| `VERCEL_TOKEN` | Vercel API token | [vercel.com/account/tokens](https://vercel.com/account/tokens) → Create Token (scope: `full`) |
| `VERCEL_ORG_ID` | Your Vercel org/personal ID | Dashboard → Settings → General → Team ID, or run `npx vercel whoami --json` locally |
| `VERCEL_PROJECT_ID` | Vercel project ID | Run `npx vercel link` locally in the project root; it creates `.vercel/project.json` containing `projectId` |
| `EXPO_TOKEN` | Expo/EAS authentication token | [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens) → Create Token |

---

## `production` environment secrets

| Secret | What it is | Where to get it |
|--------|-----------|-----------------|
| `SUPABASE_ACCESS_TOKEN` | Same Supabase CLI token (reuse from staging) | Same as staging |
| `SUPABASE_PROD_PROJECT_REF` | Production project reference ID | Create a production Supabase project and copy its Reference ID |
| `SUPABASE_PROD_DB_PASSWORD` | Production database password | Same location |
| `EXPO_TOKEN` | Same EAS token (reuse from staging) | Same as staging |

---

## CI secrets (no action needed)

The **CI** workflow (`.github/workflows/ci.yml`) uses placeholder Supabase values and does not require any secrets. It runs on all PRs and branches.

---

## How to add secrets to GitHub

1. Go to **GitHub → Settings → Environments**.
2. Click **New environment** and name it `staging` (or `production`).
3. Click the environment name → **Environment secrets**.
4. Click **Add secret** and paste each secret from the table above.
5. Repeat for the `production` environment (using production project values).

---

## Protecting production

To require manual approval before production deployments:

1. Go to **Settings → Environments → production → Required reviewers**.
2. Add yourself or a trusted reviewer.
3. Save.

Now any production migration or EAS Build (triggered by a version tag) will pause and wait for approval.

---

## Local development (`.env.local`)

You do not need a `.env.local` file to run the app locally with `npm run start`. The Supabase client reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from the environment automatically. If you want to override them locally:

```bash
export EXPO_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="eyJhbGc..."
npm run start
```

**Never commit `.env.local` or any file with real secrets.**
