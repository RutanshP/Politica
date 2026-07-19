import { NextResponse } from "next/server";

import {
  getGraphEntityById,
  listGraphEdgesTouching,
  listGraphEntitiesByIds,
} from "@/lib/graph/funding-graph-queries";
import { neighborsQuerySchema } from "@/lib/graph/funding-graph-params";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/**
 * Depth-1 neighborhood of a graph entity, for progressive node expansion.
 * `exclude` is a comma-separated list of entity ids already on the canvas.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ entityId: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const { entityId } = await params;
  const parsed = neighborsQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }

  const entity = await getGraphEntityById(entityId).catch(() => undefined);
  if (!entity) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  const excluded = new Set(
    (parsed.data.exclude || "").split(",").map((value) => value.trim()).filter(Boolean),
  );
  excluded.add(entityId);

  const edges = await listGraphEdgesTouching([entityId]).catch(() => []);
  const neighborIds = [
    ...new Set(
      edges
        .flatMap((edge) => [edge.source_entity_id, edge.target_entity_id])
        .filter((id) => !excluded.has(id)),
    ),
  ].slice(0, parsed.data.limit);

  const neighborEntities = await listGraphEntitiesByIds(neighborIds).catch(() => []);
  const visibleIds = new Set([entityId, ...neighborIds]);

  return NextResponse.json({
    entity,
    neighbors: neighborEntities,
    edges: edges.filter(
      (edge) => visibleIds.has(edge.source_entity_id) && visibleIds.has(edge.target_entity_id),
    ),
  });
}
