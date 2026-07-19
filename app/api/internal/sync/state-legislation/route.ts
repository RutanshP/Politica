import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isAuthorizedSyncRequest } from "@/lib/server/internal-api";
import { revalidatePoliticaCaches } from "@/lib/server/revalidate";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import { syncStateLegislationFromOpenStates } from "@/lib/server/state-sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const mode = /^full$/i.test(url.searchParams.get("mode") || "") ? "full" : "incremental";
  // scope=people syncs only legislators (skips the per-bill and per-committee detail fetches,
  // which dominate the runtime under OpenStates' 10 req/min limit).
  const scope = /^people$/i.test(url.searchParams.get("scope") || "") ? "people" : "all";
  // ?states=tx,ca was previously ignored -- every call synced the full default state list.
  const states = (url.searchParams.get("states") || url.searchParams.get("state") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const result = await runPipeline("state_legislation_sync", async () => {
    const sync = await syncStateLegislationFromOpenStates(
      states.length > 0 ? states : undefined,
      { mode, scope },
    );
    return { recordCount: sync.synced, metadata: sync };
  });

  revalidatePoliticaCaches();

  revalidatePath("/");
  revalidatePath("/bills");
  revalidatePath("/bills/[billId]", "page");
  revalidatePath("/bills/[billId]/timeline", "page");
  revalidatePath("/bills/[billId]/text", "page");
  revalidatePath("/bills/[billId]/votes", "page");
  revalidatePath("/committees");
  revalidatePath("/politicians");
  revalidatePath("/politicians/[slug]", "page");
  revalidatePath("/politicians/[slug]/analytics", "page");
  revalidatePath("/politicians/[slug]/votes", "page");

  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
