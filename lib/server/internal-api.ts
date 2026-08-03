import { NextResponse } from "next/server";

import { getPoliticaSyncSecret } from "@/lib/supabase/config";

/**
 * State legislature coverage is switched off, and the stored data has been deleted.
 *
 * It was 260,564 vote positions, 7,534 roll calls, 1,668 legislators, 419 committees and 128 bills
 * -- over half the database. The syncs that produced it are gated rather than removed: the code is
 * correct and worth keeping for whenever states come back, but nothing should be able to refill
 * those tables by accident. A single manual call to /state-votes would have restored ~130MB.
 *
 * Set POLITICA_ENABLE_STATE_SYNC=1 to turn it back on. Nothing else has to change.
 */
export function isStateSyncEnabled() {
  return /^(1|true|yes)$/i.test(process.env.POLITICA_ENABLE_STATE_SYNC?.trim() || "");
}

/** The 410 a gated state route answers with, or null when state sync is enabled. */
export function stateSyncDisabledResponse() {
  if (isStateSyncEnabled()) return null;

  return NextResponse.json(
    {
      ok: false,
      error: "State legislature sync is disabled",
      detail: "This deployment covers Congress only. Stored state data was deleted; re-enable with POLITICA_ENABLE_STATE_SYNC=1 before syncing states again.",
    },
    { status: 410 },
  );
}

export function isAuthorizedSyncRequest(request: Request) {
  const expectedSecret = getPoliticaSyncSecret();
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const headerSecret = request.headers.get("x-sync-secret") || "";
  const providedSecret = bearer || headerSecret;

  return Boolean(expectedSecret && providedSecret === expectedSecret);
}
