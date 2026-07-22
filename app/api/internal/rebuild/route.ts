import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import {
  loadRebuildInputs,
  rebuildAnalyticsFromStoredData,
  rebuildEntitiesFromStoredData,
  rebuildIssuesFromStoredData,
  rebuildSearchIndexFromStoredData,
  type RebuildInputs,
} from "@/lib/server/rebuilds";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Each rebuild derives from the same stored datasets. We load them once (loadRebuildInputs) and
// pass them to every rebuild, then run the rebuilds one at a time. Loading once -- rather than each
// rebuild re-fetching the corpus -- is what keeps Supabase egress down and keeps peak memory low
// enough not to crash the function.
const REBUILDERS: Record<string, {
  pipeline: string;
  run: (inputs: RebuildInputs) => Promise<{ rebuilt: number; at: string }>;
}> = {
  issues: { pipeline: "issue_rebuild", run: rebuildIssuesFromStoredData },
  entities: { pipeline: "entity_rebuild", run: rebuildEntitiesFromStoredData },
  search: { pipeline: "search_rebuild", run: rebuildSearchIndexFromStoredData },
  analytics: { pipeline: "analytics_rebuild", run: rebuildAnalyticsFromStoredData },
};

type RebuildName = keyof typeof REBUILDERS;

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const only = new URL(request.url).searchParams.get("only");
  const names: RebuildName[] = only && only in REBUILDERS
    ? [only as RebuildName]
    : (Object.keys(REBUILDERS) as RebuildName[]);

  // Load the shared corpus once and reuse it across every rebuild in this invocation.
  const inputs = await loadRebuildInputs();

  const results: Record<string, unknown> = {};
  for (const name of names) {
    const { pipeline, run } = REBUILDERS[name];
    results[name] = await runPipeline(pipeline, async () => {
      const rebuilt = await run(inputs);
      return { recordCount: rebuilt.rebuilt, metadata: rebuilt };
    });
  }

  revalidatePoliticaCaches();

  revalidatePath("/");
  revalidatePath("/analytics");
  revalidatePath("/search");
  revalidatePath("/issues");
  revalidatePath("/news");
  revalidatePath("/entities");

  const status = Object.values(results).some((item) => (item as { status?: string }).status === "failed")
    ? 500
    : 200;
  return NextResponse.json(results, { status });
}
