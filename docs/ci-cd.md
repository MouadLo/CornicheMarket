# CI/CD

The GitHub Actions workflow is `.github/workflows/pipeline.yml`. It uses npm and
the Node version in `.nvmrc`. EAS Build uses the same Node version in `eas.json`;
keep these versions aligned. Supabase requires Node 22 or newer.

## Pipeline behavior

| Trigger | Validation | Delivery |
| --- | --- | --- |
| Pull request | Lint, TypeScript, Jest, SDK dependency check, Android/iOS/web bundle export | None |
| Push to any branch | Same checks | Default branch only: Android preview APK when `ENABLE_EAS_BUILDS=true` |
| Actions → CI and mobile delivery → Run workflow | Same checks | Selected profile and platform, default branch only |

Every build depends on successful validation. EAS runs in non-interactive mode,
and GitHub waits for completion so a failed cloud build fails the job. The build
logs contain the EAS build and download links. If GitHub times out or a run is
cancelled, inspect EAS before retrying: the cloud build can still be running.

Validation uses placeholder public Supabase settings, requires no secrets, and
does not test a live backend. Exported bundles are validation output only; the
delivery job builds again with the selected EAS environment's real settings.

Preview builds produce an Android APK for installation or an iOS internal build
for registered devices. Production builds produce a signed Android App Bundle
or iOS store archive, with build numbers incremented remotely. This pipeline
delivers binaries through EAS; it does not submit to stores, publish OTA updates,
or deploy Supabase migrations/functions.

## Activate validation

This project folder did not contain a `.git` directory when the pipeline was
added. Create or connect your GitHub repository, commit the project (including
`package-lock.json` and the workflow), and push it. GitHub Actions runs validation
automatically. Delivery stays disabled until the following setup is complete.

For local checks:

```bash
nvm install
nvm use
npm ci
npm run lint
npm run typecheck
npm run test:ci
npx expo install --check
npm run export:ci
```

Local export uses your `.env` file. CI explicitly disables dotenv loading and
supplies placeholders. Never use CI export output as a distributable app.

## Set up Expo delivery

1. Sign in and link the app to an Expo project:

   ```bash
   npx eas-cli@latest login
   npx eas-cli@latest init
   npx eas-cli@latest build:configure
   ```

   Preserve the `preview` and `production` profiles in `eas.json`. If onboarding
   adds a development profile, it requires `expo-dev-client` and is independent
   of this pipeline. Commit the generated `extra.eas.projectId` and any `owner`
   value in `app.json`.

2. Set `expo.android.package` and `expo.ios.bundleIdentifier` in `app.json` to
   your chosen permanent app identifiers. The pipeline intentionally does not
   invent these. Only configure platforms you plan to build.

3. In the Expo dashboard, add both variables below to the project's `preview`
   and `production` EAS environments. Use the matching Supabase project for each:

   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`

   These values are bundled into the app. Use the public/anon key, never the
   Supabase service role key. A local `.env` or a GitHub secret alone does not
   configure the remote build environment.

4. Run one interactive **cloud** build from your terminal for each platform and
   profile you intend to use. This provisions signing credentials and resolves
   prompts that CI cannot answer. Start with Android preview:

   ```bash
   npx eas-cli@latest build --profile preview --platform android
   ```

   Repeat with `--platform ios` and/or `--profile production` as needed. iOS
   device builds require Apple signing and registered devices for internal
   distribution. Commit any resulting configuration changes. The app currently
   uses SDK 51, so confirm this first build succeeds on EAS before automation.

5. Create an [Expo access token](https://docs.expo.dev/accounts/programmatic-access/)
   in your Expo account settings. In GitHub **Settings → Secrets and variables →
   Actions**, add it as a secret named `EXPO_TOKEN`. Do not commit the token.

6. Create GitHub environments named `preview` and `production`. Restrict them
   to the repository's default branch. Configure required reviewers on
   `production` if supported by your GitHub plan. Environment-scoped
   `EXPO_TOKEN` secrets can be used instead of a repository-wide token.

7. Push the workflow to the default branch and run it manually with
   `profile=preview` and `platform=android`. After it succeeds, optionally add
   the repository Actions **variable** `ENABLE_EAS_BUILDS` with value `true`.
   Subsequent default-branch pushes create Android preview builds after CI.
   Cloud builds use your Expo account's build quota.

8. Protect the default branch and require the `Validate app` status check before
   merging. Start production builds manually from that branch by selecting
   `profile=production` and the desired platform.

## References

- [Expo CI setup and signing prerequisites](https://docs.expo.dev/build/building-on-ci/)
- [EAS build profiles](https://docs.expo.dev/build/eas-json/)
- [EAS environment variables](https://docs.expo.dev/eas/environment-variables/)
