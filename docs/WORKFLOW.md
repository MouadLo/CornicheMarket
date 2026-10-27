# Developer Workflow

_This document explains how to work on the codebase, ship a release, and recover from problems._

---

## Daily development

### 1. Create a branch

Always start from an up-to-date `main`:

```bash
git checkout main
git pull
git checkout -b your-name/what-you-are-doing
# example: git checkout -b mouad/add-supplier-screen
```

### 2. Make your changes

Work on your branch. Run `npm run check` locally before pushing to catch type errors, lint warnings, and broken tests early:

```bash
npm run check
```

The pre-commit hook runs `lint-staged` automatically when you commit, which fixes lint issues and formats changed files on the fly. No manual step needed.

### 3. Push and open a pull request

```bash
git push -u origin your-name/what-you-are-doing
```

Then open a pull request on GitHub. The **CI** workflow runs immediately and checks:
- TypeScript (no type errors)
- ESLint (no lint errors)
- 188 unit tests
- Expo SDK dependency versions
- Full Android + iOS + web bundle

The branch is **blocked from merging** until CI passes. Set this up in GitHub → Settings → Branches → Add rule → require the `check` status to pass.

### 4. Merge

After review and CI passes, use **Squash and merge** (keeps `main` history clean) or **Merge commit** (preserves individual commits). After merging:

- The **CI** workflow runs one more time on `main`.
- If it passes, **deploy-web** runs automatically: staging database migrations first, then the Expo web build deploys to Vercel.
- **mobile** runs an EAS Update that pushes the new JavaScript bundle to the **preview** channel, so testers with preview builds get it immediately without reinstalling.

---

## Releasing a new version

### Step 1: Decide the version number

Use [semantic versioning](https://semver.org/):
- **Patch** (1.0.1): bug fixes only
- **Minor** (1.1.0): new features, backwards-compatible
- **Major** (2.0.0): breaking changes

### Step 2: Update `app.json` version

Edit `app.json` and set the new version string:
```json
"version": "1.2.0"
```
Commit and push, then wait for CI to pass and the push to land on `main`.

### Step 3: Push a version tag

Tags must come from a commit already on `main`. After the merge commit is on main:

```bash
git checkout main
git pull
git tag v1.2.0
git push origin v1.2.0
```

This triggers the **mobile** workflow which:
1. Runs `check-eas-config.js` to catch configuration problems early
2. Triggers EAS Build (Android `.aab` + iOS `.ipa`) on Expo's cloud builders
3. After the build job starts, applies database migrations to **production** (via the `production` GitHub environment)

Monitor the build progress in the [Expo dashboard](https://expo.dev).

### Step 4: Submit to stores (manual)

Once the EAS build finishes:
- **Android**: download the `.aab` and upload to Google Play Console, or use `eas submit --platform android`.
- **iOS**: use `eas submit --platform ios` after the build is available.

---

## Rolling back

### Web rollback

Every Vercel deployment keeps the previous build. To roll back:

1. Go to [vercel.com](https://vercel.com) → your project → **Deployments**.
2. Find the last known-good deployment.
3. Click the three-dot menu → **Promote to Production**.

No code change needed. The rollback is instant.

### Mobile rollback

**Over-the-air (OTA):** EAS Update supports rollback per channel. To revert the preview channel to a previous bundle:

```bash
npx eas-cli@latest update --branch preview --rollback-to-embed
# or target a specific update ID:
npx eas-cli@latest update --branch preview --rollback-to <update-group-id>
```

**Binary (native code):** If you pushed a broken native build to the store, submit the previous binary. EAS keeps all builds — find the previous release in the Expo dashboard and submit it again.

### Database rollback

Supabase does **not** support automatic migration rollback. To undo a migration:

1. Write a new migration file in `supabase/migrations/` that reverses the change (e.g. drops the column you added, restores the old constraint).
2. Merge it to `main` — it will be applied to staging automatically.
3. Tag a release — it will be applied to production.

For emergencies, you can use the Supabase dashboard → **SQL editor** to run a one-off fix while you write the proper migration.

### Dropping a legacy RPC overload

Migration `20260101000017_sale_occurred_at.sql` adds a second, 6-argument overload of `record_sale` and deliberately leaves the original 5-argument version in place untouched, so that an already-installed app (which only ever sends the 5 old parameter names) keeps working exactly as before. The two signatures have no default parameters and no overlapping arity, so Postgres and PostgREST resolve a call to the right one without any risk of choosing wrong.

**Do not drop the 5-argument `record_sale` until every installed copy of the app has updated past the version that added `p_occurred_at`.** Dropping it earlier would break checkout for anyone still on the old build — the RPC call they send would no longer match anything.

How to know it is safe to drop:

1. **Check version adoption**, not database activity — the database cannot tell you which overload a given row came from (both write into the same `sales` table, and a same-day online sale looks identical either way). Use:
   - **EAS Update dashboard** (expo.dev → your project → Updates) for the OTA-updated JS bundle's adoption, if sales run through an app using EAS Update channels.
   - **Google Play Console → Release → Statistics** (and Apple App Store Connect → App Analytics, if/when iOS ships) for native build version adoption, since a user who hasn't opened the app since before this release never receives an OTA update either.
2. Wait until 100% (or your accepted risk threshold) of active devices are on a build that sends `p_occurred_at`.
3. Only then write a new migration that drops the 5-argument overload: `drop function public.record_sale(uuid, uuid, payment_method, bigint, jsonb);`. Never edit the existing migration file to remove it — migrations are append-only (see the rule above).

For a one-shop, one-phone deployment this is quick to verify by hand (check the one device); the dashboards above matter once there is more than one cashier device in the field.

---

## GitHub Secrets reference

Set these in **GitHub → Settings → Secrets and variables → Actions**.

Use **Environments** to separate staging and production secrets: create a `staging` environment and a `production` environment, then add the secrets listed below to each one.

### CI (no secrets needed)
CI uses placeholder values so it can run on forks and PRs without any real credentials.

### `staging` environment

| Secret | What it is | Where to get it |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Staging Supabase project URL | Supabase dashboard → project → Settings → API → Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Staging Supabase anon key | Supabase dashboard → project → Settings → API → `anon` key |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI personal token | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) → Generate new token |
| `SUPABASE_STAGING_PROJECT_REF` | Staging project reference (20-char string) | Supabase dashboard → staging project → Settings → General → Reference ID |
| `SUPABASE_STAGING_DB_PASSWORD` | Staging database password | Supabase dashboard → staging project → Settings → Database → Database password (or the one you set when creating the project) |
| `VERCEL_TOKEN` | Vercel API token | [vercel.com/account/tokens](https://vercel.com/account/tokens) → Create Token |
| `VERCEL_ORG_ID` | Your Vercel team/personal account ID | Run `npx vercel whoami --json` locally after `npx vercel login`, or Vercel dashboard → Settings → General → Team ID |
| `VERCEL_PROJECT_ID` | Vercel project ID | Run `npx vercel link` locally in the project root; it writes `.vercel/project.json` containing `projectId` |
| `EXPO_TOKEN` | Expo/EAS authentication token | [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens) → Create Token |

### `production` environment

| Secret | What it is | Where to get it |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Same Supabase CLI token (or a separate one) | Same as staging |
| `SUPABASE_PROD_PROJECT_REF` | Production project reference | Supabase dashboard → production project → Settings → General → Reference ID |
| `SUPABASE_PROD_DB_PASSWORD` | Production database password | Same location as staging |
| `EXPO_TOKEN` | Same EAS token | Same as staging |

### Protecting the `production` environment (recommended)

In GitHub → Settings → Environments → `production` → **Required reviewers**: add yourself or a trusted reviewer. This means the production migration step pauses and waits for a manual approval before running. One-click rollout, not an accidental deploy.

---

## One-time setup checklist

Before the pipelines work end-to-end, complete these steps once:

- [ ] Run `npx eas-cli@latest login` and `npx eas-cli@latest init` in the project root. This adds `extra.eas.projectId` to `app.json`. Commit the change.
- [ ] Set `expo.android.package` and `expo.ios.bundleIdentifier` in `app.json`.
- [ ] Create a Vercel project: `npx vercel link` in the project root. The `.vercel/project.json` it creates contains `projectId` and `orgId` — those go into GitHub Secrets. Add `.vercel/` to `.gitignore`.
- [ ] Create a staging Supabase project at [supabase.com](https://supabase.com) (free tier is fine for staging).
- [ ] Create a production Supabase project.
- [ ] Add all secrets to GitHub as listed above.
- [ ] In GitHub → Settings → Branches → Add rule for `main`: enable **Require status checks to pass** and select the `check` job from the CI workflow.
