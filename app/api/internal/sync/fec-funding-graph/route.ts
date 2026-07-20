import { NextResponse } from "next/server";

import { syncFundingGraphFromFec } from "@/lib/server/fec-funding-graph-sync";
import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";

export const dynamic = "force-dynamic";
// Long-running sync: Vercel's default function timeout is too short.
export const maxDuration = 300;

/**
 * Populates the funding-network graph from the FEC API in staleness-ordered
 * chunks. Query params:
 *   - limit: politicians per run (default 60; ~5 FEC calls each)
 *   - cycle: election cycle (default 2026, per-member fallback to 2024)
 *   - politicians: comma-separated slugs to sync explicitly
 */
export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const cycleParam = Number(url.searchParams.get("cycle"));
  const politicianSlugs = (url.searchParams.get("politicians") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const result = await runPipeline("fec_funding_graph_sync", async () => {
    const sync = await syncFundingGraphFromFec({
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
      cycle: Number.isFinite(cycleParam) && cycleParam > 1990 ? cycleParam : undefined,
      politicianSlugs: politicianSlugs.length > 0 ? politicianSlugs : undefined,
    });
    return { recordCount: sync.politiciansSynced, metadata: sync };
  });

  revalidatePoliticaCaches();

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
