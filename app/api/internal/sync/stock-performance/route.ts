import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { syncStockPerformance } from "@/lib/server/stock-performance-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scores stored trades against the market.
 *
 *   POST /api/internal/sync/stock-performance[?limit=25][&dryRun=1]
 *
 * Separate from the disclosure sync because the constraint is completely different: this one is
 * bounded by a price provider's rate limit (roughly eight symbols a minute on a free tier) rather
 * than by how many documents there are. Symbols are processed most-needed-first, so repeated calls
 * converge without a cursor.
 *
 * Returns 200 with `configured: false` when no price provider key is set. That is not a failure --
 * the disclosure data is complete and useful on its own, and only the performance columns are
 * missing -- so it should not mark the pipeline run as broken.
 */
export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 25;
  const dryRun = /^(1|true|yes)$/i.test(url.searchParams.get("dryRun") || "");

  const result = await runPipeline("stock_performance_sync", async () => {
    const sync = await syncStockPerformance({ limit, dryRun });
    return { recordCount: sync.tradesScored, metadata: sync };
  });

  if (!dryRun && result.status === "success") {
    revalidatePoliticaCaches();
  }

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
