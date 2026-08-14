import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import {
  loadMatchableMembers,
  mergeStockSyncResults,
  syncHouseStockYear,
  syncSenateStocks,
  type StockSyncResult,
} from "@/lib/server/stock-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Loads congressional stock disclosures.
 *
 *   POST /api/internal/sync/stock-disclosures[?chamber=house|senate|both][&year=2026][&limit=200][&dryRun=1]
 *
 * Paged by year for the House because each readable filing costs a PDF fetch and extraction, and a
 * full year is several hundred of them -- more than fits this route's 300s budget. The Senate half
 * is cheaper per filing (its reports are HTML) but pages the same way through `limit`.
 *
 * Defaults to the current year so the nightly schedule keeps recent filings current; a backfill
 * passes an explicit year.
 */
export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const chamber = (url.searchParams.get("chamber") || "both").toLowerCase();
  const year = Number(url.searchParams.get("year")) || new Date().getUTCFullYear();
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 150;
  const since = url.searchParams.get("since") || undefined;
  const dryRun = /^(1|true|yes)$/i.test(url.searchParams.get("dryRun") || "");

  const result = await runPipeline("stock_disclosure_sync", async () => {
    // Loaded once and shared: building the filer index per chamber would read the roster twice.
    const members = await loadMatchableMembers();
    const results: StockSyncResult[] = [];

    if (chamber === "house" || chamber === "both") {
      results.push(await syncHouseStockYear({ year, limit, members, dryRun }));
    }

    if (chamber === "senate" || chamber === "both") {
      results.push(await syncSenateStocks({ since, limit, members, dryRun }));
    }

    const merged = results.length === 1 ? results[0] : mergeStockSyncResults(results);
    return { recordCount: merged.transactionsWritten, metadata: { ...merged, year } };
  });

  if (!dryRun && result.status === "success") {
    revalidatePoliticaCaches();
  }

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
