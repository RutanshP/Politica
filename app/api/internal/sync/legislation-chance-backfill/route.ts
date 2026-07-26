import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  backfillTerminalChanceOfPassing,
  debugBillsByIds,
  findStaleTerminalChanceOfPassing,
} from "@/lib/server/legislation-sync";
import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Read-only: ?ids=hr-9238,hres-1283 for specific bills' raw stored fields, otherwise every bill
// that still disagrees with the terminal-status rule.
export async function GET(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const idsParam = new URL(request.url).searchParams.get("ids");
  if (idsParam) {
    const ids = idsParam.split(",").map((id) => id.trim()).filter(Boolean);
    return NextResponse.json({ bills: await debugBillsByIds(ids) });
  }

  return NextResponse.json(await findStaleTerminalChanceOfPassing());
}

// One-time correction endpoint -- not wired into the daily cron. New syncs already compute
// chanceOfPassing correctly (see lib/normalizers/bills.ts); this just fixes rows written before
// that fix shipped. Safe to call more than once.
export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let updatedIds: string[] = [];
  const result = await runPipeline("legislation_chance_backfill", async () => {
    const backfill = await backfillTerminalChanceOfPassing();
    updatedIds = backfill.updatedIds;
    return { recordCount: backfill.failedUpdated + backfill.signedUpdated, metadata: backfill };
  });

  revalidatePoliticaCaches();

  revalidatePath("/");
  revalidatePath("/bills");
  // Each bill detail page is its own cached route (revalidate = 21600s) independent of the
  // /bills listing -- without this, a corrected bill keeps rendering its old cached score for up
  // to 6 hours.
  for (const id of updatedIds) {
    revalidatePath(`/bills/${id}`);
  }

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
