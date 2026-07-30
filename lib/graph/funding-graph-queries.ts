import { FUNDING_GRAPH_CACHE_TAG } from "@/lib/supabase/cache-tags";
import { fetchSupabasePage, fetchSupabaseRows } from "@/lib/supabase/rest";
import type { FundingSourceRecord, GraphEdgeRow, GraphEntityRow } from "@/types/funding-graph";

const GRAPH_ENTITY_SELECT =
  "id,slug,entity_type,label,subtitle,image_url,metadata,source_system,source_id,source_url,synced_at";
const GRAPH_EDGE_SELECT =
  "id,source_entity_id,target_entity_id,relationship_type,relationship_direction,amount,transaction_count,election_cycle,occurred_at,start_date,end_date,is_aggregate,confidence,metadata,source_system,source_id,source_url,synced_at";
const SOURCE_RECORD_SELECT =
  "id,edge_id,record_type,amount,occurred_on,contributor_name,contributor_employer,contributor_occupation,recipient,description,source_url,source_system";

function buildQuotedInFilter(values: string[]) {
  return values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",");
}

export async function getGraphEntityByPoliticianSlug(slug: string) {
  const rows = await fetchSupabaseRows<GraphEntityRow>(
    "graph_entities",
    `entity_type=eq.politician&slug=eq.${encodeURIComponent(slug)}&limit=1`,
    { select: GRAPH_ENTITY_SELECT, tags: [FUNDING_GRAPH_CACHE_TAG] },
  );
  return rows[0];
}

export async function getGraphEntityById(entityId: string) {
  const rows = await fetchSupabaseRows<GraphEntityRow>(
    "graph_entities",
    `id=eq.${encodeURIComponent(entityId)}&limit=1`,
    { select: GRAPH_ENTITY_SELECT, tags: [FUNDING_GRAPH_CACHE_TAG] },
  );
  return rows[0];
}

export async function listGraphEntitiesByIds(entityIds: string[]) {
  if (entityIds.length === 0) return [] as GraphEntityRow[];

  const chunkSize = 100;
  const rows: GraphEntityRow[] = [];
  for (let index = 0; index < entityIds.length; index += chunkSize) {
    const chunk = entityIds.slice(index, index + chunkSize);
    const result = await fetchSupabaseRows<GraphEntityRow>(
      "graph_entities",
      `id=in.(${buildQuotedInFilter(chunk)})`,
      { select: GRAPH_ENTITY_SELECT, tags: [FUNDING_GRAPH_CACHE_TAG], paginateAll: true },
    );
    rows.push(...result);
  }
  return rows;
}

/** All edges touching any of the given entity ids, in either direction. */
export async function listGraphEdgesTouching(entityIds: string[]) {
  if (entityIds.length === 0) return [] as GraphEdgeRow[];

  const chunkSize = 50;
  const rows: GraphEdgeRow[] = [];
  for (let index = 0; index < entityIds.length; index += chunkSize) {
    const chunk = buildQuotedInFilter(entityIds.slice(index, index + chunkSize));
    const result = await fetchSupabaseRows<GraphEdgeRow>(
      "graph_edges",
      `or=(source_entity_id.in.(${chunk}),target_entity_id.in.(${chunk}))&order=amount.desc.nullslast`,
      { select: GRAPH_EDGE_SELECT, tags: [FUNDING_GRAPH_CACHE_TAG], paginateAll: true },
    );
    rows.push(...result);
  }

  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

/**
 * Retained (lobbying) edges whose source is one of the given employer nodes. Lobbying firms hang
 * off employer nodes, which sit at the outer rim of the money BFS -- one hop past where the depth
 * cap looks -- so they are attached in a targeted pass over employers already reached rather than
 * by widening the whole walk.
 */
export async function listRetainedEdgesBySourceIds(employerIds: string[]) {
  if (employerIds.length === 0) return [] as GraphEdgeRow[];

  const chunkSize = 50;
  const rows: GraphEdgeRow[] = [];
  for (let index = 0; index < employerIds.length; index += chunkSize) {
    const chunk = buildQuotedInFilter(employerIds.slice(index, index + chunkSize));
    const result = await fetchSupabaseRows<GraphEdgeRow>(
      "graph_edges",
      `relationship_type=eq.retained&source_entity_id=in.(${chunk})&order=amount.desc.nullslast`,
      { select: GRAPH_EDGE_SELECT, tags: [FUNDING_GRAPH_CACHE_TAG], paginateAll: true },
    );
    rows.push(...result);
  }

  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

export async function getGraphEdgeById(edgeId: string) {
  const rows = await fetchSupabaseRows<GraphEdgeRow>(
    "graph_edges",
    `id=eq.${encodeURIComponent(edgeId)}&limit=1`,
    { select: GRAPH_EDGE_SELECT, tags: [FUNDING_GRAPH_CACHE_TAG] },
  );
  return rows[0];
}

/** edge_id -> underlying source-record count, for the given edges. */
export async function countSourceRecordsByEdgeIds(edgeIds: string[]) {
  const counts = new Map<string, number>();
  if (edgeIds.length === 0) return counts;

  const chunkSize = 100;
  for (let index = 0; index < edgeIds.length; index += chunkSize) {
    const chunk = edgeIds.slice(index, index + chunkSize);
    const rows = await fetchSupabaseRows<{ edge_id: string }>(
      "funding_source_records",
      `edge_id=in.(${buildQuotedInFilter(chunk)})`,
      { select: "edge_id", tags: [FUNDING_GRAPH_CACHE_TAG], paginateAll: true },
    );
    for (const row of rows) {
      counts.set(row.edge_id, (counts.get(row.edge_id) || 0) + 1);
    }
  }
  return counts;
}

export async function listSourceRecordsPage(edgeId: string, limit: number, offset: number) {
  return fetchSupabasePage<FundingSourceRecord>(
    "funding_source_records",
    `edge_id=eq.${encodeURIComponent(edgeId)}&order=occurred_on.desc.nullslast`,
    { select: SOURCE_RECORD_SELECT, tags: [FUNDING_GRAPH_CACHE_TAG], limit, offset, count: "exact" },
  );
}

/** Committee rows (real stored data) for the legislative side of the graph. */
export async function listCommitteesForPolitician(politicianId: string) {
  const memberships = await fetchSupabaseRows<{ committee_id: string; role: string }>(
    "committee_members",
    `politician_id=eq.${encodeURIComponent(politicianId)}&order=sort_order.asc`,
    // committee_members has no `id`, and sort_order repeats across rows.
    { select: "committee_id,role", tags: [FUNDING_GRAPH_CACHE_TAG], paginateAll: true, paginateTiebreaker: "committee_id" },
  );
  if (memberships.length === 0) {
    return [] as Array<{ id: string; slug: string; name: string; chamber: string; role: string }>;
  }

  const committeeIds = [...new Set(memberships.map((row) => row.committee_id))];
  const committees = await fetchSupabaseRows<{ id: string; slug: string; name: string; chamber: string }>(
    "committees",
    `id=in.(${buildQuotedInFilter(committeeIds)})`,
    { select: "id,slug,name,chamber", tags: [FUNDING_GRAPH_CACHE_TAG] },
  );
  const roleByCommitteeId = new Map(memberships.map((row) => [row.committee_id, row.role]));

  return committees.map((committee) => ({
    ...committee,
    role: roleByCommitteeId.get(committee.id) || "member",
  }));
}
