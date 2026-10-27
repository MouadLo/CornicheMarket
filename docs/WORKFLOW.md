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
2. Commit and merge to `main`.
3. Tag a release — it will be applied when you push the version tag.

For emergencies, you can use the Supabase dashboard → **SQL editor** to run a one-off fix while you write the proper migration.

---

## Releasing a database change safely

Because you have one Supabase project (no staging), migrations are **applied only when you push a version tag**, never on merge to main. This ensures an older app version never breaks if you apply a migration in advance.

### Before you add a migration

1. **Take a backup** (recommended):
   - Go to Supabase dashboard → your project → Backups
   - Click **Take Backup Now** and wait for it to complete (5–15 min)
   - Note the backup date so you can restore it if needed

2. **Test locally** with your migration and seed data:
   ```bash
   # This resets your local database and reruns all migrations in order
   supabase db reset
   ```
   This catches syntax errors, constraint violations, and data loss issues *before* they reach production.

3. **Design migrations to be backwards-compatible**:
   - ✅ Add new columns/tables
   - ✅ Add new constraints that allow existing data
   - ❌ Never drop columns or rename them in one release (older app versions read the old column names)
   - ❌ Never add `NOT NULL` without a default value
   - ❌ Never change a column type if the old app still writes the old type

   **Example:** Adding a feature that uses a new column:
   - Release v1.1 with the app code that uses the new column (still works without it)
   - Release v1.2 with the migration that creates the column
   - Older app versions (v1.1) keep working; new versions (v1.2) use the column

4. **When you're ready to release:**
   - Push the migration to `main` via a PR (tested locally, reviewed)
   - Update `app.json` to the next version (e.g. 1.1.0 → 1.2.0)
   - Merge to `main` — CI runs, all tests pass
   - Tag the version: `git tag v1.2.0 && git push origin v1.2.0`
   - The mobile.yml workflow applies the migration to Supabase and builds the app
   - Monitor the Expo dashboard for build success

### If a migration fails halfway

This is rare but can happen if the migration is invalid or the database is in a locked state.

**Check the migration status:**
- Go to Supabase dashboard → Migrations tab
- See which migration succeeded and which failed

**Rollback and fix:**
1. Restore from the backup you took earlier (if one exists): Backups tab → Restore
2. Fix the migration file in `supabase/migrations/` (e.g. syntax error, wrong column type)
3. Test locally: `supabase db reset`
4. Create a new commit and tag a new version (e.g. v1.2.1)

**If you don't have a backup:**
1. Use the Supabase SQL editor to manually undo the partial changes
2. Fix the migration file
3. Test locally and tag a new version

---

## GitHub Secrets reference

See [docs/SECRETS.md](./SECRETS.md) for the complete list of secrets and where to get each one. All secrets go in **GitHub → Settings → Secrets and variables → Actions** (not environment-specific, since you have one Supabase project).

---

## One-time setup checklist

Before the pipelines work end-to-end, complete these steps once:

- [ ] Run `npx eas-cli@latest login` and `npx eas-cli@latest init` in the project root. This adds `extra.eas.projectId` to `app.json`. Commit the change.
- [ ] Set `expo.android.package` and `expo.ios.bundleIdentifier` in `app.json`.
- [ ] Create a Vercel project: `npx vercel link` in the project root. The `.vercel/project.json` it creates contains `projectId` and `orgId` — those go into GitHub Secrets. Add `.vercel/` to `.gitignore`.
- [ ] Create one Supabase project at [supabase.com](https://supabase.com) for all environments (free tier is fine).
- [ ] Add all secrets to GitHub (see [docs/SECRETS.md](./SECRETS.md)).
- [ ] In GitHub → Settings → Branches → Add rule for `main`: enable **Require status checks to pass** and select the `check` job from the CI workflow.
