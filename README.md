# Politica

Politica is a responsive civic intelligence MVP built with Next.js, TypeScript, Tailwind CSS, Recharts, and React Flow. It now follows a stored-data-first architecture: production routes read from Supabase, and external APIs feed the database through protected sync and rebuild pipelines.

## Included MVP surfaces

- Home dashboard
- Bills explorer
- Bill detail, text, and votes pages
- Politician directory, profile, analytics, and funding pages
- Committee page
- Issue page
- News page
- Watchlist page
- Analytics dashboard
- Funding network graph page
- Pipeline health and sync-status routes

## Stack

- Next.js 16 App Router
- TypeScript
- Tailwind CSS v4
- Recharts
- `@xyflow/react`

## Getting started

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Optional live data setup

To enable live federal, state, finance, and news ingestion:

1. Copy `.env.example` to `.env.local`
2. Set the API keys you want to use
3. Run the SQL files in `supabase/sql/`
4. Restart the dev server

```bash
copy .env.example .env.local
```

The app uses:

- `POLITICA_DEFAULT_CONGRESS`
- `POLITICA_CONGRESS_API_BASE_URL`
- `POLITICA_CONGRESS_API_KEY`
- `POLITICA_OPENSTATES_API_BASE_URL`
- `POLITICA_OPENSTATES_API_KEY`
- `POLITICA_FEC_API_BASE_URL`
- `POLITICA_FEC_API_KEY`
- `POLITICA_NEWS_API_BASE_URL`
- `POLITICA_NEWS_API_KEY`
- `POLITICA_SYNC_SECRET`

If those values are missing, Politica stays in explicit unconfigured or partial states instead of pretending the missing data is live.

## Project structure

- `app/`: App Router pages
- `components/`: reusable dashboard, table, tab, graph, and chart components
- `lib/adapters/`: external API clients
- `lib/normalizers/`: payload-to-domain mapping
- `lib/data/`: server-side loaders used by routes
- `lib/server/`: sync workers, rebuild jobs, and pipeline orchestration
- `types/civic.ts`: shared interfaces for bills, votes, politicians, committees, issues, watchlist items, and graph edges
- `tests/`: runnable Node tests plus Playwright route-matrix scaffolding

## Data model direction

The stored layer now centers on these entities:

- `jurisdictions`
- `legislativeSessions`
- `bills`
- `billActions`
- `billVersions`
- `politicians`
- `billSponsors`
- `votes`
- `votePositions`
- `committees`
- `committeeMembers`
- `issues`
- `issueBillLinks`
- `newsItems`
- `newsEntityLinks`
- `entities`
- `entityRelationships`
- `financeEntities`
- `financeEdges`
- `analyticsSnapshots`
- `searchDocuments`
- `syncRuns`
- `syncErrors`

## Future API integration notes

Planned data sources:

- Congress.gov API for federal bills, actions, sponsors, committees, and bill text
- OpenStates API for state bills, votes, legislators, committees, and sessions
- FEC API for campaign finance
- NewsAPI for connected political coverage

The implementation now follows a flow like:

`cron job -> fetch API data -> normalize -> upsert database -> refresh search index -> recalculate analytics -> render frontend`

Protected endpoints now exist for:

- `/api/internal/sync/legislation`
- `/api/internal/sync/politicians`
- `/api/internal/sync/state-legislation`
- `/api/internal/sync/finance`
- `/api/internal/sync/news`
- `/api/internal/rebuild`

Current live-data status:

- Bills, politicians, committees, issues, news, finance graph data, sync status, and analytics now read from stored Supabase-backed loaders
- Congress, OpenStates, FEC, and News API adapters are ingestion-only clients used by sync workers
- Search, issue clusters, entity indexes, and analytics snapshots are rebuilt into stored tables through the rebuild pipeline
- `/elections` remains intentionally minimal in v1

## Notes

- The app uses local CSS font stacks so builds work reliably in offline or sandboxed environments.
- Watchlist and profile remain non-user-scoped app-level views in v1.
- `npm test` runs the zero-install Node test suite.
- `npm run test:e2e` requires installing Playwright first.
