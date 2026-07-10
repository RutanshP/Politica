import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { syncNewsFromApi } from "@/lib/server/news-sync";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runPipeline("news_sync", async () => {
    const sync = await syncNewsFromApi();
    return { recordCount: sync.synced, metadata: sync };
  });

  revalidatePath("/");
  revalidatePath("/news");

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
