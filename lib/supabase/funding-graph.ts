import { FUNDING_GRAPH_CACHE_TAG } from "@/lib/supabase/cache-tags";
import {
  deleteSupabaseRows,
  fetchSupabaseRows,
  upsertSupabaseRowsInChunks,
} from "@/lib/supabase/rest";
import type { GraphEdgeRow, GraphEntityRow } from "@/types/funding-graph";
import type { CandidateFinanceSnapshotRow } from "@/types/supabase";

export { FUNDING_GRAPH_CACHE_TAG };

export async function upsertGraphEntities(rows: GraphEntityRow[]) {
  if (rows.length === 0) return [];
  return upsertSupabaseRowsInChunks("graph_entities", rows, "id", 100);
}

export async function upsertGraphEdges(rows: GraphEdgeRow[]) {
  if (rows.length === 0) return [];
  return upsertSupabaseRowsInChunks("graph_edges", rows, "id", 100);
}

export async function upsertCandidateFinanceSnapshots(rows: CandidateFinanceSnapshotRow[]) {
  if (rows.length === 0) return [];
  return upsertSupabaseRowsInChunks("candidate_finance_snapshots", rows, "id", 100);
}

/**
 * The politician graph entities the FEC sync has already written, used to pick
 * the stalest members for the next chunk. Sync path: must see current rows.
 */
export async function listFecSyncedPoliticianEntities() {
  return fetchSupabaseRows<Pick<GraphEntityRow, "id" | "slug" | "synced_at" | "source_system">>(
    "graph_entities",
    "entity_type=eq.politician&order=synced_at.asc",
    { cache: "no-store", select: "id,slug,synced_at,source_system", paginateAll: true },
  );
}

/**
 * Removes the illustrative demo fixture once real FEC data replaces it. The
 * fixture is a single self-contained subgraph (see supabase/sql/010), so a
 * blanket delete by source_system is safe: entity deletion cascades to
 * aliases, and edge deletion cascades to funding_source_records.
 */
export async function purgeDemoFixture() {
  await deleteSupabaseRows("graph_edges", "source_system=eq.demo_fixture");
  await deleteSupabaseRows("graph_entities", "source_system=eq.demo_fixture");
}
