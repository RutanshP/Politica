import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { syncStateVotesFromOpenStates } from "@/lib/server/state-vote-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const dryRun = /^(1|true|yes)$/i.test(url.searchParams.get("dryRun") || "");
    const states = (url.searchParams.get("states") || url.searchParams.get("state") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (states.length === 0) {
      return NextResponse.json({ error: "Provide ?states=tx,ca" }, { status: 400 });
    }

    // Sequential: OpenStates rate-limits aggressively, and a parallel fan-out across states is the
    // fastest way to get throttled.
    const results = [];
    for (const state of states) {
      results.push(await syncStateVotesFromOpenStates({ state, dryRun }));
    }

    if (!dryRun) {
      revalidatePoliticaCaches();
    }

    return NextResponse.json({ ok: true, dryRun, results });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "State vote sync failed" },
      { status: 500 },
    );
  }
}
