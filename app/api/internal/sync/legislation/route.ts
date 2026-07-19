import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { syncLegislationFromCongress } from "@/lib/server/legislation-sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const targetBillIds = (url.searchParams.get("billIds") || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const syncVotes = /^(1|true|yes)$/i.test(url.searchParams.get("syncVotes") || "");
    const syncCommittees = /^(1|true|yes)$/i.test(url.searchParams.get("syncCommittees") || "");
    const refreshStoredVotes = /^(1|true|yes)$/i.test(url.searchParams.get("refreshStoredVotes") || "");
    const mode = /^full$/i.test(url.searchParams.get("mode") || "") ? "full" : "incremental";
    const listOffset = Number.parseInt(url.searchParams.get("offset") || "0", 10);
    const listLimit = Number.parseInt(url.searchParams.get("limit") || "0", 10);
    const result = await runPipeline("federal_legislation_sync", async () => {
      const sync = await syncLegislationFromCongress({
        targetBillIds,
        syncVotes,
        syncCommittees,
        refreshStoredVotes,
        mode,
        listOffset: Number.isFinite(listOffset) && listOffset >= 0 ? listOffset : 0,
        listLimit: Number.isFinite(listLimit) && listLimit > 0 ? listLimit : undefined,
      });
      return {
        recordCount: sync.billsSynced + sync.committeesSynced + sync.votesSynced,
        metadata: sync,
      };
    });

    revalidatePoliticaCaches();

    revalidatePath("/");
    revalidatePath("/bills");
    revalidatePath("/bills/[billId]", "page");
    revalidatePath("/bills/[billId]/timeline", "page");
    revalidatePath("/bills/[billId]/text", "page");
    revalidatePath("/bills/[billId]/votes", "page");
    revalidatePath("/committees");
    revalidatePath("/issues");
    revalidatePath("/news");
    revalidatePath("/politicians");
    revalidatePath("/politicians/[slug]", "page");
    revalidatePath("/politicians/[slug]/analytics", "page");
    revalidatePath("/politicians/[slug]/votes", "page");

    return NextResponse.json({
      ...result,
    }, { status: result.status === "failed" ? 500 : 200 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown sync error",
      },
      { status: 500 },
    );
  }
}
