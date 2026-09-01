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
| `POLITICA_OPENSTATES_API_KEY` | OpenStates API key (governors; state legislature sync is off) |
| `POLITICA_NEWS_API_KEY` | News API key |
| `POLITICA_SYNC_SECRET` | Bearer token guarding the internal sync routes |
| `POLITICA_SUPABASE_SCHEMA` | e.g. `public` (only if you set it locally) |
| `POLITICA_FEC_API_BASE_URL`, `POLITICA_CONGRESS_API_BASE_URL`, `POLITICA_NEWS_API_BASE_URL`, `POLITICA_OPENSTATES_API_BASE_URL`, `POLITICA_DEFAULT_CONGRESS` | Optional overrides — set only if present in `.env.local` |

Then click **Deploy**. (`CRON_SECRET` / `POLITICA_PUBLIC_URL` are only needed for
the optional Vercel-Cron path in step 4 — skip them if you use GitHub Actions.)

## 3. Scheduling (GitHub Actions — free, recommended)

Scheduling lives in **GitHub Actions**, not Vercel Cron, so you don't need Vercel
Pro. `.github/workflows/sync-daily.yml` runs daily on GitHub's servers and calls
the deployed app's sync endpoints in small chunks. Because the sync runs *on*
Vercel, it also busts Vercel's cache so the live site reflects the new data.

Add two repo secrets (GitHub repo → **Settings → Secrets and variables → Actions
→ New repository secret**):

| Secret | Value |
|---|---|
| `POLITICA_APP_URL` | your Vercel URL, e.g. `https://politica.vercel.app` (no trailing slash) |
| `POLITICA_SYNC_SECRET` | the **same** value you set in Vercel |

That's it — the workflow runs daily at 10:00 UTC and can be run on demand from the
**Actions** tab → *Politica daily sync* → **Run workflow**. It does: federal
roster, recent bills+votes, a FEC funding rotation (8 chunks of `limit=8`,
~64 members/day by staleness), news, and a derived-data rebuild.

### Why small chunks

A `limit=60` FEC chunk takes ~6 minutes — longer than any Vercel function may run
(Hobby caps at 60s). So the workflow uses small `limit` values that finish inside
the timeout and **loops** (GitHub Actions itself has no such limit). On Vercel Pro
you can raise `FEC_LIMIT`/`FEC_CHUNKS` in the workflow for faster coverage. The
initial full backfill is already done, so day-to-day this just keeps data current.

## 4. Optional: Vercel Cron instead (needs Pro)

If you'd rather schedule inside Vercel (and are on Pro), `app/api/cron/[job]/route.ts`
is ready — it verifies `CRON_SECRET` and calls the same endpoints. Add a
`vercel.json` at the repo root:

```json
{
  "crons": [
    { "path": "/api/cron/fec", "schedule": "*/20 * * * *" },
    { "path": "/api/cron/news", "schedule": "0 * * * *" },
    { "path": "/api/cron/rebuild", "schedule": "30 10,22 * * *" },
    { "path": "/api/cron/federal", "schedule": "0 10 * * *" }
  ]
}
```

and set a `CRON_SECRET` env var in Vercel (`openssl rand -hex 32`). Use **either**
GitHub Actions **or** Vercel Cron — not both, or every member syncs twice.

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
