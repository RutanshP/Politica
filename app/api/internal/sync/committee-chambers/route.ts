import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { repairStateCommitteeChambers } from "@/lib/server/committee-chamber-repair";

export const dynamic = "force-dynamic";

/**
 * Resolves the chamber of state committees that OpenStates delivered without one.
 * Optional ?states=CA,NY to scope it; otherwise every state with unresolved committees.
 */
export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const states = (new URL(request.url).searchParams.get("states") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const result = await runPipeline("committee_chamber_repair", async () => {
    const repair = await repairStateCommitteeChambers({
      states: states.length > 0 ? states : undefined,
    });
    return { recordCount: repair.resolved, metadata: repair };
  });

  revalidatePoliticaCaches();

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
