import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { checkSyncHealth } from "@/lib/server/sync-health";

export const dynamic = "force-dynamic";

/**
 * Whether the scheduled syncs are working, for the nightly workflow's last step: 200 with
 * ok:false when a pipeline is stale or "succeeded" without doing its job, so the run fails and
 * GitHub notifies the owner. See lib/server/sync-health.ts.
 */
export async function GET(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await checkSyncHealth());
}
