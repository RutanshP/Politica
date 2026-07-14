import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { repairUnmatchedVotePositions } from "@/lib/server/vote-position-repair";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dryRun = /^(1|true|yes)$/i.test(new URL(request.url).searchParams.get("dryRun") || "");
    const result = await repairUnmatchedVotePositions({ dryRun });

    if (!dryRun) {
      revalidatePoliticaCaches();
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Vote position repair failed" },
      { status: 500 },
    );
  }
}
