import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { syncPoliticiansFromCongress } from "@/lib/server/politician-sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const mode = /^full$/i.test(url.searchParams.get("mode") || "") ? "full" : "incremental";
    const listOffset = Number.parseInt(url.searchParams.get("offset") || "0", 10);
    const listLimit = Number.parseInt(url.searchParams.get("limit") || "0", 10);
    const result = await runPipeline("federal_members_sync", async () => {
      const sync = await syncPoliticiansFromCongress({
        mode,
        listOffset: Number.isFinite(listOffset) && listOffset >= 0 ? listOffset : 0,
        listLimit: Number.isFinite(listLimit) && listLimit > 0 ? listLimit : undefined,
      });
      return {
        recordCount: sync.synced,
        metadata: sync,
      };
    });

    revalidatePoliticaCaches();

    revalidatePath("/politicians");
    revalidatePath("/profile");

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
