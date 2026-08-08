import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { syncExecutiveBranch } from "@/lib/server/executive-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Syncs the executive branch: President and Vice President, plus governors for the states given.
 *
 *   POST /api/internal/sync/executive[?states=tx,ny][&federal=0][&dryRun=1]
 *
 * Governors are paged by state because OpenStates rate-limits at roughly ten requests a minute --
 * all fifty in one call would take five minutes against this route's 300s budget. The federal half
 * is a single static file and costs one request, so it runs by default.
 *
 * Not covered by the state-sync gate. That gate exists to stop 1,668 state legislators and 260k
 * vote positions coming back; a governor is one row per state and is wanted here.
 */
export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const states = (url.searchParams.get("states") || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const includeFederal = !/^(0|false|no)$/i.test(url.searchParams.get("federal") || "");
  const dryRun = /^(1|true|yes)$/i.test(url.searchParams.get("dryRun") || "");

  const result = await runPipeline("executive_sync", async () => {
    const sync = await syncExecutiveBranch({ states, includeFederal, dryRun });
    return { recordCount: sync.presidentsSynced + sync.governorsSynced, metadata: sync };
  });

  if (!dryRun && result.status === "success") {
    revalidatePoliticaCaches();
  }

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
