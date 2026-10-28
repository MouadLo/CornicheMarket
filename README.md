# Welcome to your Expo app 👋

## CI/CD

GitHub Actions validates pushes and pull requests with lint, TypeScript, Jest,
SDK dependency checks, and Android/iOS/web bundle exports. EAS build delivery
supports preview APKs and production binaries after Expo onboarding.
See [CI/CD setup](docs/ci-cd.md) for activation, credentials, and release steps.

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
    npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Running against local Supabase (recommended for development)

The app needs a Supabase backend to do anything beyond the sign-in screen. Running against **local** Supabase (via Docker) instead of the real project means you can reset and re-seed the database freely without touching real data.

### 1. Start local Supabase

```bash
npx supabase start
```

The first run downloads Docker images and can take a few minutes. Leave this running — "stop" below shuts it down.

### 2. Point the app at it

Run this once per machine:

```bash
npx supabase status
```

Copy the **API URL** (`http://127.0.0.1:54321`) and the **Publishable** key into a new `.env.local` file (copy `.env.local.example` and fill it in):

```bash
cp .env.local.example .env.local
```

`.env.local` overrides `.env` automatically (Expo loads it with higher priority) and is gitignored — **never commit it**, and never put a real production key in it. `.env` itself stays pointed at the real Supabase project, so you don't have to touch it to switch between local and production: add or delete `.env.local` instead.

A common mistake here: the Supabase **API URL** (`http://127.0.0.1:54321`) is not the same as the **database connection string** (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) also printed by `supabase status` — the app needs the API URL. Pasting the Postgres connection string into `EXPO_PUBLIC_SUPABASE_URL` by mistake makes every request to Supabase hang indefinitely, which looks like the app being stuck on its loading screen forever.

### 3. Load the database with realistic test data

```bash
npx supabase db reset
```

This applies every migration and `supabase/seed.sql` from scratch: ~200 products, ~300 historical sales, customers, and two accounts you can actually sign in with. The reset prints them at the end, but they're also here:

| Role | Email | Password |
|---|---|---|
| Owner | `owner@corniche.local` | `owner123` |
| Cashier | `cashier@corniche.local` | `cashier123` |

These only exist in your local database and are **never** created against the real Supabase project.

### 4. Run the app

```bash
npm install   # first time only
npx expo start
```

Sign in with one of the accounts above.

### Troubleshooting

- **Stuck on the loading spinner for more than ~10 seconds**: the app will show an error screen explaining what to check (usually the URL mistake above, or `supabase start` not actually running — check with `npx supabase status`).
- **Auth errors referencing a missing column, or anything from `supabase/seed.sql` failing**: your local Supabase's internal data may be stale from an older version. Reset it completely and restart:
  ```bash
  npx supabase stop --no-backup
  npx supabase start
  ```
- **Stop everything** when you're done: `npx supabase stop`.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
