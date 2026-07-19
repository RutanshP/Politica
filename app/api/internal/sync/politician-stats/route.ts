import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { backfillMissingPoliticianVoteStatCounters } from "@/lib/server/politician-stat-backfill";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const offset = Number.parseInt(url.searchParams.get("offset") || "0", 10);
  const limit = Number.parseInt(url.searchParams.get("limit") || "0", 10);

  const result = await runPipeline("politician_vote_stat_backfill", async () => {
    const backfill = await backfillMissingPoliticianVoteStatCounters({
      offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    });
    return {
      recordCount: backfill.updated,
      metadata: backfill,
    };
  });

  revalidatePoliticaCaches();

  revalidatePath("/politicians");
  revalidatePath("/politicians/[slug]", "page");
  revalidatePath("/politicians/[slug]/analytics", "page");
  revalidatePath("/politicians/[slug]/votes", "page");
  revalidatePath("/profile");

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
