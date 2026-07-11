import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { syncLegislationFromCongress } from "@/lib/server/legislation-sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runPipeline("federal_legislation_sync", async () => {
      const sync = await syncLegislationFromCongress();
      return {
        recordCount: sync.billsSynced + sync.committeesSynced + sync.votesSynced,
        metadata: sync,
      };
    });

    revalidatePath("/");
    revalidatePath("/bills");
    revalidatePath("/committees");
    revalidatePath("/issues");
    revalidatePath("/news");

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
