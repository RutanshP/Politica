import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
// Vercel function budget for a cron chunk. Each job below is sized to finish
// within this: FEC runs a small `limit`, the others are incremental/quick.
// Hobby caps at 60s; Pro allows up to 300s (higher with Fluid Compute).
export const maxDuration = 300;

/**
 * Scheduled entry point for Vercel Cron. Vercel invokes these paths over GET and
 * (when CRON_SECRET is set) attaches `Authorization: Bearer <CRON_SECRET>`, which
 * we verify. Each job fans out to the existing internal sync endpoints via an
 * authenticated self-call, so all pipeline/auth/revalidation logic is reused.
 *
 * Jobs are deliberately small so one invocation fits the function timeout; the
 * schedule (see vercel.json) is what advances coverage. FEC funding rotates by
 * staleness, so firing `fec` frequently cycles every member over the day.
 */
const JOBS: Record<string, string[]> = {
  // Fast, must-run-often housekeeping.
  fec: ["/api/internal/sync/fec-funding-graph?limit=10"],
  news: ["/api/internal/sync/news"],
  rebuild: ["/api/internal/rebuild"],
  // Roster changes (new/departed members) + a small legislation page.
  federal: [
    "/api/internal/sync/politicians?limit=250",
    "/api/internal/sync/legislation?offset=0&limit=25&syncVotes=true",
    /*
     * Re-fetches stored roll calls, which is how a parser change reaches rows already stored --
     * votes.question and votes.description were backfilled this way. listOffset stays 0 because
     * the endpoint returns what most needs refreshing first (question nulls-first, then
     * oldest-synced), so repeated calls advance on their own. Kept in step with the
     * VOTE_REFRESH_* loop in .github/workflows/sync-daily.yml, which is the schedule actually in
     * use; run one or the other, not both.
     */
    "/api/internal/sync/legislation?refreshStoredVotes=1&listOffset=0&listLimit=25",
    // Labels amendment roll calls with the amendment they were on. Paged by bill and need-ordered,
    // so like the refresh above it advances without a cursor. Runs after it: this only considers
    // votes whose question says they were on an amendment.
    "/api/internal/sync/bill-amendments?limit=4",
    /*
     * President and Vice President only -- one static file, one request. Governors are omitted
     * here because OpenStates throttles to 10 requests a minute and all fifty would blow this
     * job's budget; the GitHub workflow, which is the schedule actually in use, walks a seventh of
     * the states each night instead.
     */
    "/api/internal/sync/executive",
  ],
  /*
   * Stock disclosures for the current year, plus a slice of price scoring. Only the current year
   * moves -- members file within 45 days of a trade -- so prior years are backfilled once by hand
   * with ?year= rather than re-fetched nightly. The performance call is bounded by the price
   * provider's rate limit (~8 symbols a minute), not by document count, and returns
   * configured:false rather than failing when no key is set.
   */
  stocks: [
    "/api/internal/sync/stock-disclosures?chamber=both&limit=150",
    "/api/internal/sync/stock-performance?limit=25",
  ],
  // Weekly-ish deeper refresh.
  finance: ["/api/internal/sync/finance"],
  committees: ["/api/internal/sync/legislation?offset=0&limit=25&syncCommittees=true"],
};

function resolveBaseUrl() {
  const configured = process.env.POLITICA_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://127.0.0.1:3000";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ job: string }> },
) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { job } = await params;
  const paths = JOBS[job];
  if (!paths) {
    return NextResponse.json({ error: `Unknown cron job: ${job}` }, { status: 404 });
  }

  const syncSecret = process.env.POLITICA_SYNC_SECRET?.trim();
  const base = resolveBaseUrl();
  const results: Array<{ path: string; status: number; ok: boolean }> = [];

  // Sequential so the shared FEC rate gate and the DB stay unstressed.
  for (const path of paths) {
    try {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${syncSecret}` },
        cache: "no-store",
      });
      results.push({ path, status: response.status, ok: response.ok });
    } catch (error) {
      results.push({ path, status: 0, ok: false });
      void error;
    }
  }

  const ok = results.every((result) => result.ok);
  return NextResponse.json({ job, ok, results, at: new Date().toISOString() }, { status: ok ? 200 : 502 });
}
