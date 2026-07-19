import { NextResponse } from "next/server";

import { getGraphEdgeById, listSourceRecordsPage } from "@/lib/graph/funding-graph-queries";
import { edgeRecordsQuerySchema } from "@/lib/graph/funding-graph-params";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/** Paginated underlying source records for a graph edge. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ edgeId: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const { edgeId } = await params;
  const parsed = edgeRecordsQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }

  const edge = await getGraphEdgeById(edgeId).catch(() => undefined);
  if (!edge) {
    return NextResponse.json({ error: "Edge not found" }, { status: 404 });
  }

  const { page, pageSize } = parsed.data;
  const { rows, total } = await listSourceRecordsPage(edgeId, pageSize, (page - 1) * pageSize);

  return NextResponse.json({
    edge,
    records: rows,
    page,
    pageSize,
    total,
  });
}
