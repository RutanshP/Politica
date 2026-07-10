import { NextResponse } from "next/server";

import { getSyncStatusData } from "@/lib/data/sync-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getSyncStatusData();
  const degraded = data.runs.filter((run) => run.status === "failed" || run.status === "partial");

  return NextResponse.json({
    ok: degraded.length === 0,
    latestRunAt: data.runs[0]?.finished_at || data.runs[0]?.started_at || null,
    degradedPipelines: degraded.map((run) => run.pipeline),
    runs: data.runs,
  });
}
