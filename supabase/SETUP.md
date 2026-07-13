# Supabase Setup For Politica

## What this enables

This setup makes Politica DB-backed for:

1. politicians
2. bills
3. bill actions
4. bill text versions
5. committees
6. issues, news, finance graph, analytics, search, and sync health pages

Congress.gov is now intended for sync jobs, not normal page rendering.

## 1. Create the tables and indexes

In the Supabase SQL Editor, run all five files:

- `supabase/sql/001_politica_politicians.sql`
- `supabase/sql/002_politica_legislation.sql`
- `supabase/sql/003_politica_platform.sql`
- `supabase/sql/004_politica_civic_read_indexes.sql`
- `supabase/sql/005_politica_incremental_sync_metadata.sql`

## 2. Copy project keys

From the Supabase project dashboard, get:

- Project URL
- Publishable key
- Secret key

Put them into `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SECRET_KEY=your-secret-key
POLITICA_SUPABASE_SCHEMA=public
POLITICA_SYNC_SECRET=make-this-a-long-random-secret
POLITICA_OPENSTATES_API_KEY=your-openstates-key
POLITICA_FEC_API_KEY=your-fec-key
POLITICA_NEWS_API_KEY=your-news-api-key
```

## 3. Seed data once

Call the protected sync and rebuild endpoints:

```powershell
$headers = @{
  Authorization = "Bearer YOUR_POLITICA_SYNC_SECRET"
}

Invoke-WebRequest `
  -Method POST `
  -Uri http://127.0.0.1:3000/api/internal/sync/politicians `
  -Headers $headers

Invoke-WebRequest `
  -Method POST `
  -Uri http://127.0.0.1:3000/api/internal/sync/legislation `
  -Headers $headers

Invoke-WebRequest `
  -Method POST `
  -Uri http://127.0.0.1:3000/api/internal/sync/state-legislation `
  -Headers $headers

Invoke-WebRequest `
  -Method POST `
  -Uri http://127.0.0.1:3000/api/internal/sync/finance `
  -Headers $headers

Invoke-WebRequest `
  -Method POST `
  -Uri http://127.0.0.1:3000/api/internal/sync/news `
  -Headers $headers

Invoke-WebRequest `
  -Method POST `
  -Uri http://127.0.0.1:3000/api/internal/rebuild `
  -Headers $headers
```

## 4. Schedule recurring syncs

Recommended pattern:

- Use Supabase `pg_cron`
- Use `pg_net`
- Store the target URL and secret in Supabase Vault
- Have cron call the Politica sync endpoints on a schedule

Suggested schedule:

- legislation: every 6 hours
- politicians: daily
- state legislation: daily
- finance: daily
- news: every 6 hours
- rebuild: every 6 hours after upstream syncs

Example targets:

- `https://YOUR-APP-DOMAIN/api/internal/sync/legislation`
- `https://YOUR-APP-DOMAIN/api/internal/sync/politicians`
- `https://YOUR-APP-DOMAIN/api/internal/sync/state-legislation`
- `https://YOUR-APP-DOMAIN/api/internal/sync/finance`
- `https://YOUR-APP-DOMAIN/api/internal/sync/news`
- `https://YOUR-APP-DOMAIN/api/internal/rebuild`

## 5. Verify

After the sync succeeds:

- `/politicians` should render stored Supabase data
- `/bills` should render stored bill data
- `/committees` should render stored committee data
- `/issues` and `/news` should render first-class stored records
- `/money` and `/money/graph` should render stored finance graph data
- `/more` should render sync-run history
- `/api/politicians` should return politician records from the database
- `/api/health` should expose latest run timestamps and degraded pipelines

## Notes

- Federal vote-position completeness still depends on upstream source availability.
- Playwright E2E scaffolding is included, but Playwright still needs to be installed before running `npm run test:e2e`.
