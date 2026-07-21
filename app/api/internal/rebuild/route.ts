import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import {
  rebuildAnalyticsFromStoredData,
  rebuildEntitiesFromStoredData,
  rebuildIssuesFromStoredData,
  rebuildSearchIndexFromStoredData,
} from "@/lib/server/rebuilds";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Each rebuild scans the whole dataset. Running all four at once (the old
// Promise.all) peaks memory hard enough to crash a constrained serverless
// function. They now run one at a time, and `?only=<name>` runs a single one so
// a caller (e.g. the GitHub Actions workflow) can spread them across separate
// function invocations, each with its own memory/time budget.
const REBUILDERS = {
  issues: { pipeline: "issue_rebuild", run: rebuildIssuesFromStoredData },
  entities: { pipeline: "entity_rebuild", run: rebuildEntitiesFromStoredData },
  search: { pipeline: "search_rebuild", run: rebuildSearchIndexFromStoredData },
  analytics: { pipeline: "analytics_rebuild", run: rebuildAnalyticsFromStoredData },
} as const;

type RebuildName = keyof typeof REBUILDERS;

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const only = new URL(request.url).searchParams.get("only");
  const names: RebuildName[] = only && only in REBUILDERS
    ? [only as RebuildName]
    : (Object.keys(REBUILDERS) as RebuildName[]);

  const results: Record<string, unknown> = {};
  for (const name of names) {
    const { pipeline, run } = REBUILDERS[name];
    results[name] = await runPipeline(pipeline, async () => {
      const rebuilt = await run();
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
