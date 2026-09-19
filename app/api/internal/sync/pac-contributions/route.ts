import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { syncPacContributions } from "@/lib/server/pac-contributions-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Named PAC contributions to sitting members, in staleness-ordered chunks. Query params:
 *   - limit: members per run (default 20; ~2-4 FEC calls each at ~1.1s apiece)
 *   - cycle: election cycle (default 2026)
 *   - politicians: comma-separated bioguide ids to sync explicitly
 */
export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const cycleParam = Number(url.searchParams.get("cycle"));
  const politicianIds = (url.searchParams.get("politicians") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const result = await runPipeline("pac_contributions_sync", async () => {
    const sync = await syncPacContributions({
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
      cycle: Number.isFinite(cycleParam) && cycleParam > 1990 ? cycleParam : undefined,
      politicianIds: politicianIds.length > 0 ? politicianIds : undefined,
    });
    return { recordCount: sync.contributionsWritten, metadata: sync };
  });

  revalidatePoliticaCaches();

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
