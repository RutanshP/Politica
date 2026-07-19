import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { syncFederalMemberSponsoredBillHistory } from "@/lib/server/legislation-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") || "0", 10);
  const bioguideIds = (url.searchParams.get("bioguideIds") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const result = await runPipeline("federal_sponsored_bill_history_sync", async () => {
    const sync = await syncFederalMemberSponsoredBillHistory({
      bioguideIds: bioguideIds.length > 0 ? bioguideIds : undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    });
    return {
      recordCount: sync.billsInserted,
      metadata: sync,
    };
  });

  revalidatePoliticaCaches();

  revalidatePath("/politicians");
  revalidatePath("/politicians/[slug]", "page");
  revalidatePath("/politicians/[slug]/analytics", "page");

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
