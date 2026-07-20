import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { syncFinanceFromFec } from "@/lib/server/finance-sync";
import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runPipeline("finance_sync", async () => {
    const sync = await syncFinanceFromFec();
    return { recordCount: sync.synced, metadata: sync };
  });

  revalidatePoliticaCaches();

  revalidatePath("/money");
  revalidatePath("/money/graph");
  revalidatePath("/money/network");

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
