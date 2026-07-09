# Politica

Politica is a responsive civic intelligence MVP built with Next.js, TypeScript, Tailwind CSS, Recharts, and React Flow. It now includes a real bills data path for Congress.gov with a safe fallback to local fixtures when API credentials are not configured.

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

## Optional real Congress-backed setup

To enable live federal bill data from Congress.gov for the home dashboard bill cards, all `/bills/*` routes, the politician directory/profile pages, and the relationship graph pages:

1. Copy `.env.example` to `.env.local`
2. Set `POLITICA_CONGRESS_API_KEY`
3. Restart the dev server

```bash
copy .env.example .env.local
```

The app uses:

- `POLITICA_DEFAULT_CONGRESS`
- `POLITICA_CONGRESS_API_BASE_URL`
- `POLITICA_CONGRESS_API_KEY`
- `POLITICA_FEC_API_BASE_URL`
- `POLITICA_FEC_API_KEY`

If those values are missing or the API call fails, Politica falls back to the existing local mock bill fixtures so the app still runs.

## Project structure

- `app/`: App Router pages
- `components/`: reusable dashboard, table, tab, graph, and chart components
- `lib/adapters/`: external API clients
- `lib/normalizers/`: payload-to-domain mapping
- `lib/data/`: server-side loaders used by routes
- `lib/mock-data.ts`: typed mock entities and selectors
- `types/civic.ts`: shared interfaces for bills, votes, politicians, committees, issues, watchlist items, and graph edges
- `lib/server/sync-jobs.ts`: placeholder scheduled sync jobs for future live data ingestion

## Data model direction

The mock layer is intentionally shaped around these future entities:

- `bills`
- `billActions`
- `billVersions`
- `politicians`
- `billSponsors`
- `votes`
- `votePositions`
- `committees`
- `committeeMembers`
- `entities`
- `edges`
- `issues`
- `watchlistItems`
- `newsItems`

## Future API integration notes

Planned data sources:

- Congress.gov API for federal bills, actions, sponsors, committees, and bill text
- Open States API for state bills, votes, legislators, committees, and sessions
- LegiScan as an alternate multi-jurisdiction feed
- FEC API for campaign finance
- OpenSecrets later for lobbying and finance context

The implementation is prepared for a flow like:

`cron job -> fetch API data -> normalize -> upsert database -> refresh search index -> recalculate analytics -> render frontend`

See [lib/server/sync-jobs.ts](./lib/server/sync-jobs.ts) for the placeholder job scaffold.

Current live-data status:

- Bills list and bill detail routes can fetch from Congress.gov through [lib/adapters/congress.ts](./lib/adapters/congress.ts)
- Raw payloads are normalized into app-facing bill types in [lib/normalizers/bills.ts](./lib/normalizers/bills.ts)
- Routes call server loaders in [lib/data/bills.ts](./lib/data/bills.ts)
- Politician routes now derive live sponsor/member profiles from the live bills layer in [lib/data/politicians.ts](./lib/data/politicians.ts), with fallback profile enrichment from local fixtures
- The network graph routes now build a live Congress relationship graph from politicians, sponsored bills, and issue nodes in [lib/data/graph.ts](./lib/data/graph.ts)
- Committees, issues, vote-position tables, watchlist persistence, finance-specific edges, and news ingestion still rely on mock or derived fixture data

## Notes

- The app uses local CSS font stacks so builds work reliably in offline or sandboxed environments.
- Watchlist behavior is local-only mock state for now.
- Some pages intentionally keep explorer/filter UI lightweight while preserving the full route structure and component boundaries for later live data work.
