import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { backfillTerminalChanceOfPassing } from "@/lib/server/legislation-sync";
import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// One-time correction endpoint -- not wired into the daily cron. New syncs already compute
// chanceOfPassing correctly (see lib/normalizers/bills.ts); this just fixes rows written before
// that fix shipped. Safe to call more than once.
export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runPipeline("legislation_chance_backfill", async () => {
    const backfill = await backfillTerminalChanceOfPassing();
    return { recordCount: backfill.failedUpdated + backfill.signedUpdated, metadata: backfill };
  });

  revalidatePoliticaCaches();

  revalidatePath("/");
  revalidatePath("/bills");

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
