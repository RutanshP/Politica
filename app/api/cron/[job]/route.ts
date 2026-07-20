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
