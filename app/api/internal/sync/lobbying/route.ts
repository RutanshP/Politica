import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { rebuildLobbyingGraph, syncLobbyingFilings } from "@/lib/server/lobbying-sync";

export const dynamic = "force-dynamic";

/**
 * Lobbying disclosure ingestion.
 *
 * Two modes, because the LDA API caps page_size at 25 and a year of quarterly filings is a few
 * thousand requests:
 *
 *   POST ?year=2026&filingType=Q1&page=1&pages=40   ingest a slice, returns the next cursor
 *   POST ?mode=graph&years=2025,2026                rebuild graph entities/edges from what's stored
 *
 * Ingestion only writes filing rows. The graph totals are computed from those rows by the graph
 * mode, so re-running a slice cannot double count.
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

  const year = Number.parseInt(url.searchParams.get("year") || "", 10);
  if (!Number.isFinite(year)) {
    return NextResponse.json({ error: "year is required" }, { status: 400 });
  }

  const page = Number.parseInt(url.searchParams.get("page") || "1", 10);
  const pages = Number.parseInt(url.searchParams.get("pages") || "0", 10);

  const result = await runPipeline("lobbying_filings_sync", async () => {
    const sync = await syncLobbyingFilings({
      year,
      filingType: url.searchParams.get("filingType") || undefined,
      startPage: Number.isFinite(page) && page > 0 ? page : 1,
      pageBudget: Number.isFinite(pages) && pages > 0 ? pages : undefined,
    });
    return { recordCount: sync.filingsUpserted, metadata: sync };
  });

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
