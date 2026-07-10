import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { syncStateLegislationFromOpenStates } from "@/lib/server/state-sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runPipeline("state_legislation_sync", async () => {
    const sync = await syncStateLegislationFromOpenStates();
    return { recordCount: sync.synced, metadata: sync };
  });

  revalidatePath("/");
  revalidatePath("/bills");
  revalidatePath("/committees");
  revalidatePath("/politicians");

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
