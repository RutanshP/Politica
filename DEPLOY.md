# Deploying Politica to Vercel (with scheduled syncs)

This hosts the app on a public URL **and** runs the data syncs on a schedule, so
the database stays fresh with your computer off. The database (Supabase) is
already cloud-hosted; deploying gives the sync jobs a home too.

## 1. Import the repo

1. Go to https://vercel.com/new and import `RutanshP/Politica` from GitHub.
2. Framework preset: **Next.js** (auto-detected). Leave build/output defaults.
3. Don't deploy yet — set the environment variables first (next step).

## 2. Environment variables

In the Vercel project → **Settings → Environment Variables**, add each of these
for **Production** (and Preview if you want preview deploys to work). Copy the
values from your local `.env.local`:

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/publishable key |
| `SUPABASE_SECRET_KEY` | Supabase service/secret key (server-only) |
| `POLITICA_FEC_API_KEY` | FEC API key |
| `POLITICA_CONGRESS_API_KEY` | Congress.gov API key |
| `POLITICA_OPENSTATES_API_KEY` | OpenStates API key (state data) |
| `POLITICA_NEWS_API_KEY` | News API key |
| `POLITICA_SYNC_SECRET` | Bearer token guarding the internal sync routes |
| `POLITICA_SUPABASE_SCHEMA` | e.g. `public` (only if you set it locally) |
| `POLITICA_FEC_API_BASE_URL`, `POLITICA_CONGRESS_API_BASE_URL`, `POLITICA_NEWS_API_BASE_URL`, `POLITICA_OPENSTATES_API_BASE_URL`, `POLITICA_DEFAULT_CONGRESS` | Optional overrides — set only if present in `.env.local` |

Then add two **new** variables that only exist in the cloud:

| Variable | Value |
|---|---|
| `CRON_SECRET` | A long random string. Vercel automatically sends it as `Authorization: Bearer <CRON_SECRET>` to the cron routes, which verify it. Generate one with `openssl rand -hex 32`. |
| `POLITICA_PUBLIC_URL` | Optional. Your production URL, e.g. `https://politica.vercel.app`. If unset, the cron falls back to `VERCEL_URL` (also fine). |

Then click **Deploy**.

## 3. Scheduled syncs (already wired)

`vercel.json` declares the cron jobs; `app/api/cron/[job]/route.ts` runs each one
by calling the existing internal sync endpoints. Current schedule (UTC):

| Job | Schedule | What it does |
|---|---|---|
| `fec` | every 20 min | FEC funding graph, `limit=10` — rotates by staleness, cycles every member across the day |
| `news` | hourly | News refresh |
| `rebuild` | 10:30 & 22:30 | Rebuild derived data (analytics/search/issues/graph) |
| `federal` | daily 10:00 | Federal roster (new/departed members) + recent bills/votes |
| `finance` | Mondays 11:00 | Finance refresh |
| `committees` | Mondays 11:30 | Committee membership refresh |

### Plan requirement

**Frequent crons need Vercel Pro.** On the Hobby plan, cron jobs run **at most
once per day** and functions are capped at **60s** — too short for these syncs.
On Pro, functions get up to 300s (`maxDuration` is already set to 300 on the
sync routes), which fits each chunked job.

If you stay on Hobby: keep only one or two daily crons (e.g. `federal` and
`rebuild`) and run the FEC rotation another way (see below).

## 4. Why the jobs are small

A single `limit=60` FEC chunk takes ~6 minutes — longer than any serverless
timeout. So each cron does a **small** chunk (`fec` uses `limit=10` ≈ 60–90s) and
the **schedule** provides coverage: `fec` every 20 min = ~720 member-syncs/day,
which cycles all ~535 members with refresh to spare. The initial full backfill is
already done, so the crons only need to keep data current.

## 5. Manual trigger / testing

Every internal sync route still works via authenticated POST, so you can trigger
a sync by hand or from any external scheduler:

```bash
curl -X POST -H "Authorization: Bearer $POLITICA_SYNC_SECRET" \
  "https://<your-app>.vercel.app/api/internal/sync/fec-funding-graph?limit=10"
```

## 6. Heavy one-off re-syncs

A full deep re-sync of **all** bills/votes (thousands of paginated requests) is
not cron-friendly on serverless. If you ever need it, run it from a machine (the
existing `scripts/windows/*.ps1`) or a GitHub Actions job that builds the app and
loops the paginated endpoints — neither has a per-request timeout. Day-to-day the
crons above keep everything current.

## 7. Retire the local Windows tasks (optional)

Once Vercel cron is running, the local Task Scheduler jobs are redundant:

```powershell
Get-ScheduledTask | Where-Object { $_.TaskName -like "*Politica*" } | Disable-ScheduledTask
```
