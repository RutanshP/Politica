import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest, stateSyncDisabledResponse } from "@/lib/server/internal-api";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { syncStateVotesFromOpenStates } from "@/lib/server/state-vote-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Gated: this was the heaviest writer in the system and its data has been deleted.
  const disabled = stateSyncDisabledResponse();
  if (disabled) return disabled;

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

    /*
     * Wrapped in runPipeline like every other sync route. It was the one that wasn't, and it is by
     * some distance the heaviest writer in the system: it added 229,689 vote_positions rows across
     * two days (07-31 and 08-02) -- more rows than the rest of the syncs combined -- while leaving
     * no trace in sync_runs, so the growth was invisible in the only place anyone would look for
     * it. This also picks up the in-process lock, which matters here because OpenStates
     * rate-limits: two overlapping runs starve each other.
     *
     * dryRun still records a run. That is deliberate -- a dry run reports what a real one would
     * write, which is exactly the number worth having in the history before a large backfill.
     */
    const result = await runPipeline("state_vote_sync", async () => {
      // Sequential: OpenStates rate-limits aggressively, and a parallel fan-out across states is
      // the fastest way to get throttled.
      const results = [];
      for (const state of states) {
        results.push(await syncStateVotesFromOpenStates({ state, dryRun }));
      }

      return {
        recordCount: results.reduce((sum, item) => sum + item.positionsMatched, 0),
        metadata: { dryRun, states, results },
      };
    });

    const results = (result.metadata as { results?: unknown[] } | undefined)?.results ?? [];

    // Only revalidate on a run that actually wrote. A "skipped" status means the lock was held by
    // another run, so nothing changed and there is nothing to bust.
    if (!dryRun && result.status === "success") {
      revalidatePoliticaCaches();
      revalidatePath("/politicians");
      revalidatePath("/politicians/[slug]", "page");
      revalidatePath("/politicians/[slug]/analytics", "page");
      revalidatePath("/politicians/[slug]/votes", "page");
    }

    // Response keeps its original {ok, dryRun, results} shape for existing callers, with the
    // pipeline summary added alongside.
    return NextResponse.json(
      { ok: result.status !== "failed", dryRun, results, pipeline: result },
      { status: result.status === "failed" ? 500 : 200 },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "State vote sync failed" },
      { status: 500 },
    );
  }
}
