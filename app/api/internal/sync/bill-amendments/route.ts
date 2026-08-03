import { NextResponse } from "next/server";

import { getDefaultCongress } from "@/lib/adapters/congress";
import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { syncAmendmentLinks } from "@/lib/server/amendment-link-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Labels amendment roll calls with the amendment they were on.
 *
 * Paged by bill rather than by vote: one congress.gov request returns a bill's whole amendment
 * slate, so `limit` counts bills and each one typically labels a dozen-plus votes. It selects the
 * bills with the most unlabelled amendment votes first, so a scheduled call with no cursor still
 * works through the backlog and goes quiet once everything is labelled.
 *
 *   POST /api/internal/sync/bill-amendments?limit=10[&dryRun=1][&congress=119]
 */
export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const dryRun = /^(1|true|yes)$/i.test(url.searchParams.get("dryRun") || "");
  const congress = url.searchParams.get("congress")?.trim() || getDefaultCongress();

  // withText=0 skips the Rules Committee PDFs, which are one fetch per amendment on top of the
  // page scrape. On by default: the text is the point of the link.
  const withText = !/^(0|false|no)$/i.test(url.searchParams.get("withText") || "");

  const result = await runPipeline("bill_amendment_links", async () => {
    const sync = await syncAmendmentLinks({
      congress,
      // Small by default: with withText on, a bill costs a Rules page plus one PDF per amendment,
      // so 10 bills can exceed this route's 300s budget on a heavily amended measure.
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 4,
      dryRun,
      withText,
    });
    return { recordCount: sync.votesLabelled, metadata: sync };
  });

  if (!dryRun && result.status === "success") {
    revalidatePoliticaCaches();
  }

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
