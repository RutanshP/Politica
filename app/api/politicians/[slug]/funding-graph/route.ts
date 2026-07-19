import { NextResponse } from "next/server";

import { buildPoliticianFundingGraph } from "@/lib/graph/build-politician-funding-graph";
import { parseFundingGraphQuery } from "@/lib/graph/funding-graph-params";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const { slug: politicianId } = await params;
  const parsed = parseFundingGraphQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const graph = await buildPoliticianFundingGraph(politicianId, parsed.filters);
  if (!graph) {
    return NextResponse.json({ error: "Politician not found" }, { status: 404 });
  }

  return NextResponse.json(graph, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600" },
  });
}
