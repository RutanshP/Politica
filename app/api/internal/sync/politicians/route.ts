import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { syncPoliticiansFromCongress } from "@/lib/server/politician-sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runPipeline("federal_members_sync", async () => {
      const sync = await syncPoliticiansFromCongress();
      return {
        recordCount: sync.synced,
        metadata: sync,
      };
    });

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
