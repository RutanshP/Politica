import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { pruneExpiredFailedBills } from "@/lib/server/legislation-sync";
import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runPipeline("legislation_cleanup", async () => {
    const cleanup = await pruneExpiredFailedBills();
    return { recordCount: cleanup.deleted, metadata: cleanup };
  });

  revalidatePoliticaCaches();

  revalidatePath("/");
  revalidatePath("/bills");

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
