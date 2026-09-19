import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { rebuildLobbyingGraph, syncLobbyingFilings } from "@/lib/server/lobbying-sync";

export const dynamic = "force-dynamic";

// A slice of up to 60 pages runs about a minute and a half at the LDA's pace.
export const maxDuration = 300;

/**
 * Lobbying disclosure ingestion.
 *
 *   POST ?pages=60                       ingest reports posted since the stored cursor; loop while done=false
 *   POST ?since=2025-01-01&pages=60      reset the cursor first
 *   POST ?since=A&before=B&pages=60      one closed window, cursor untouched (parallel backfills)
 *   POST ?mode=graph&years=2025,2026     rebuild the funding-graph lobbying edges from what is stored
 *
 * Ingestion only writes report rows and the bills they cite. Which report counts for a quarter,
 * and every total, is computed from those rows, so re-running a slice cannot double count.
 */
export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");

  if (mode === "graph") {
    const years = (url.searchParams.get("years") || "")
      .split(",")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value));

    const result = await runPipeline("lobbying_graph_rebuild", async () => {
      const graph = await rebuildLobbyingGraph(years.length > 0 ? years : undefined);
      return { recordCount: graph.retainedEdges, metadata: graph };
    });

    revalidatePoliticaCaches();
    return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
  }

  const since = url.searchParams.get("since")?.trim();
  if (since && Number.isNaN(Date.parse(since))) {
    return NextResponse.json({ error: "since must be a date" }, { status: 400 });
  }
  const before = url.searchParams.get("before")?.trim();
  if (before && Number.isNaN(Date.parse(before))) {
    return NextResponse.json({ error: "before must be a date" }, { status: 400 });
  }
  const pages = Number.parseInt(url.searchParams.get("pages") || "0", 10);

  // A closed window is a backfill slice run side by side with others, so it skips the pipeline's
  // one-run-at-a-time lock and its run log; the cursor-driven nightly run goes through both.
  if (before) {
    try {
      const sync = await syncLobbyingFilings({
        postedAfter: since || undefined,
        postedBefore: before,
        pageBudget: Number.isFinite(pages) && pages > 0 ? pages : undefined,
      });
      return NextResponse.json({ pipeline: "lobbying_backfill", status: "success", metadata: sync });
    } catch (error) {
      return NextResponse.json(
        { pipeline: "lobbying_backfill", status: "failed", error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }
  }

  const result = await runPipeline("lobbying_filings_sync", async () => {
    const sync = await syncLobbyingFilings({
      postedAfter: since || undefined,
      pageBudget: Number.isFinite(pages) && pages > 0 ? pages : undefined,
    });
    return { recordCount: sync.reportsUpserted, metadata: sync };
  });

  if (result.status === "success") revalidatePoliticaCaches();
  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
