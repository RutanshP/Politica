import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import {
  rebuildAnalyticsFromStoredData,
  rebuildEntitiesFromStoredData,
  rebuildIssuesFromStoredData,
  rebuildSearchIndexFromStoredData,
} from "@/lib/server/rebuilds";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [issues, entities, search, analytics] = await Promise.all([
    runPipeline("issue_rebuild", async () => {
      const rebuilt = await rebuildIssuesFromStoredData();
      return { recordCount: rebuilt.rebuilt, metadata: rebuilt };
    }),
    runPipeline("entity_rebuild", async () => {
      const rebuilt = await rebuildEntitiesFromStoredData();
      return { recordCount: rebuilt.rebuilt, metadata: rebuilt };
    }),
    runPipeline("search_rebuild", async () => {
      const rebuilt = await rebuildSearchIndexFromStoredData();
      return { recordCount: rebuilt.rebuilt, metadata: rebuilt };
    }),
    runPipeline("analytics_rebuild", async () => {
      const rebuilt = await rebuildAnalyticsFromStoredData();
      return { recordCount: rebuilt.rebuilt, metadata: rebuilt };
    }),
  ]);

  revalidatePath("/");
  revalidatePath("/analytics");
  revalidatePath("/search");
  revalidatePath("/issues");
  revalidatePath("/news");
  revalidatePath("/entities");

  const status = [issues, entities, search, analytics].some((item) => item.status === "failed") ? 500 : 200;
  return NextResponse.json({ issues, entities, search, analytics }, { status });
}
