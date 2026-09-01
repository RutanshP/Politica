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
- Elections: federal races on the ballot this cycle
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

To enable live federal, executive, finance, and news ingestion:

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
- OpenStates API for governors (state legislature coverage is switched off -- see below)
- FEC API for campaign finance
- NewsAPI.ai / Event Registry for connected political coverage

The implementation now follows a flow like:

`cron job -> fetch API data -> normalize -> upsert database -> refresh search index -> recalculate analytics -> render frontend`

Protected endpoints now exist for:

- `/api/internal/sync/legislation`
- `/api/internal/sync/politicians`
- `/api/internal/sync/finance`
- `/api/internal/sync/news`
- `/api/internal/rebuild`

Current live-data status:

- Bills, politicians, committees, issues, news, finance graph data, sync status, and analytics now read from stored Supabase-backed loaders
- Congress, OpenStates, FEC, and NewsAPI.ai adapters are ingestion-only clients used by sync workers
- Search, issue clusters, entity indexes, and analytics snapshots are rebuilt into stored tables through the rebuild pipeline
- `/elections` lists every federal race with candidates on file for the cycle, from stored FEC filings

## Scope: Congress only

State legislature coverage was built, then switched off and its stored data deleted -- it was over
half the database (260,564 vote positions, 7,534 roll calls, 1,668 legislators, 419 committees,
128 bills). `supabase/sql/027_politica_drop_state_data.sql` is the record of that delete.

What this means today:

- Bills, votes, and committees are federal only.
- The politician directory's "State" level holds the fifty governors and nothing else. They come
  from OpenStates via `/api/internal/sync/executive`, not from the legislature syncs.
- `/api/internal/sync/state-legislation` and `/api/internal/sync/state-votes` answer `410` and are
  not scheduled. The workers behind them are kept intact, not deleted.

Set `POLITICA_ENABLE_STATE_SYNC=1` to turn the syncs back on; nothing else has to change. Expect
the database to grow by roughly 130MB once the state votes repopulate.

## Elections

`/elections` groups stored FEC candidate filings into the seats they contest -- 479 races for the
2026 cycle, being 35 Senate seats, 443 House districts and one filing whose district the FEC left
blank. Each race lists everyone on file, incumbent first, and links sitting members to their
profile.

This is federal-only by construction, not by a filter: the FEC files House, Senate and President
and nothing else, so there is no state legislature or governor data in the feed. (State coverage
elsewhere in the app is the governors, stored in `politicians`.) A midterm has no presidential
race, and the chamber filter is built from the data, so "President" simply does not appear.

Three caveats the UI states rather than hides:

- Candidates are FEC filings, not a certified ballot -- they include everyone who filed as a
  statutory candidate, before any primary narrowed the field. Withdrawn (`candidate_inactive`)
  and not-yet-qualified (`candidate_status != 'C'`) filings are excluded.
- `election_year` is what separates "up this cycle" from "holds an open committee". Without it,
  every sitting senator would appear to be defending their seat.
- Fundraising is stored per `politician_id`, which only sitting members have, so challengers show
  "No filing stored" rather than $0. `cash_on_hand` is never displayed: it is 0 on every stored
  snapshot because the finance sync does not populate it.

Set `POLITICA_ELECTION_CYCLE` to move the page to a later cycle.

## Notes

- The app uses local CSS font stacks so builds work reliably in offline or sandboxed environments.
- Watchlist and profile remain non-user-scoped app-level views in v1.
- `npm test` runs the zero-install Node test suite.
- `npm run test:e2e` requires installing Playwright first.
