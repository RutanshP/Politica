import { NextResponse } from "next/server";

import { syncElectionCandidatesFromFec } from "@/lib/server/election-candidates-sync";
import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Syncs the federal candidate roster from FEC -- House + Senate at the current cycle, President
 * at the next presidential cycle. Query params (both optional, override the module defaults):
 *   - houseSenateCycle: e.g. 2026
 *   - presidentialCycle: e.g. 2028
 */
export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const houseSenateCycleParam = Number(url.searchParams.get("houseSenateCycle"));
  const presidentialCycleParam = Number(url.searchParams.get("presidentialCycle"));

  const result = await runPipeline("election_candidates_sync", async () => {
    const sync = await syncElectionCandidatesFromFec({
      houseSenateCycle: Number.isFinite(houseSenateCycleParam) && houseSenateCycleParam > 1990
        ? houseSenateCycleParam
        : undefined,
      presidentialCycle: Number.isFinite(presidentialCycleParam) && presidentialCycleParam > 1990
        ? presidentialCycleParam
        : undefined,
    });
    return { recordCount: sync.candidatesSynced, metadata: sync };
  });

  revalidatePoliticaCaches();

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
