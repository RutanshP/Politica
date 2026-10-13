import { NextResponse } from "next/server";

import { getSyncStatusData } from "@/lib/data/sync-status";

export const dynamic = "force-dynamic";

/**
 * Public, so it returns only what a status check needs. It used to echo the last 50 runs whole --
 * metadata and upstream error messages included -- uncached, to anyone, on every request.
 */
export async function GET() {
  const data = await getSyncStatusData();
  const degraded = data.runs.filter((run) => run.status === "failed" || run.status === "partial");

  return NextResponse.json(
    {
      ok: degraded.length === 0,
      latestRunAt: data.runs[0]?.finished_at || data.runs[0]?.started_at || null,
      degradedPipelines: [...new Set(degraded.map((run) => run.pipeline))],
      runs: data.runs.map(({ pipeline, status, started_at, finished_at }) => ({ pipeline, status, started_at, finished_at })),
    },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
