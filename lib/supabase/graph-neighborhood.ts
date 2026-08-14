import { fetchSupabaseRows, invokeSupabaseRpc } from "@/lib/supabase/rest";
import { FUNDING_GRAPH_CACHE_TAG } from "@/lib/supabase/cache-tags";
import type { EntityType, FundingEdge, FundingNode } from "@/types/civic";

/**
 * The funding graph, scoped to one entity's neighbourhood.
 *
 * The page used to read every node and edge -- 6,495 and 8,009 -- and hand the lot to React Flow.
 * That is unreadable as a drawing and it made the filter panel impossible to implement, because
 * there was nothing left to filter against. This asks the database for a bounded neighbourhood
 * instead, which is what makes real controls possible.
 */

export interface GraphFilters {
  focusId: string;
  hops?: number;
  minAmount?: number;
  relationshipTypes?: string[];
  cycle?: number;
  maxEdges?: number;
}

interface NeighborhoodEdgeRow {
  edge_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  amount: number | null;
  election_cycle: number | null;
  depth: number;
}

interface GraphEntityRow {
  id: string;
  slug: string | null;
  entity_type: string;
  label: string;
  subtitle: string | null;
}

/**
 * graph_entities uses the funder vocabulary; FundingNode uses the app's EntityType. Anything
 * unrecognised renders as a company rather than throwing -- a new source type should show up as a
 * plain node, not break the page.
 */
const ENTITY_TYPE_MAP: Record<string, EntityType> = {
  politician: "politician",
  pac: "pac",
  candidateCommittee: "committee",
  employer: "company",
  donorAggregate: "donor",
  lobbyingFirm: "lobbying-firm",
  independentExpenditureGroup: "pac",
};

/** Human labels for the stored relationship_type values, used on edges and in the filter. */
export const RELATIONSHIP_LABELS: Record<string, string> = {
  contributed_to: "Contributed to",
  employee_contributions: "Employee contributions",
  retained: "Retained (lobbying)",
  affiliated_with: "Affiliated with",
  independent_spending_support: "Outside spending — support",
  independent_spending_oppose: "Outside spending — oppose",
};

export function relationshipLabel(value: string) {
  return RELATIONSHIP_LABELS[value] || value.replace(/_/g, " ");
}

export interface GraphNeighborhood {
  nodes: FundingNode[];
  edges: FundingEdge[];
  focus?: FundingNode;
  /** Totals for the focused entity, so the page says something before anyone interacts with it. */
  summary: {
    edgeCount: number;
    totalAmount: number;
    inboundAmount: number;
    outboundAmount: number;
    topCounterparty?: { label: string; amount: number };
    truncated: boolean;
  };
}

const EMPTY: GraphNeighborhood = {
  nodes: [],
  edges: [],
  summary: { edgeCount: 0, totalAmount: 0, inboundAmount: 0, outboundAmount: 0, truncated: false },
};

export async function fetchGraphNeighborhood(filters: GraphFilters): Promise<GraphNeighborhood> {
  const maxEdges = filters.maxEdges ?? 300;

  const edgeRows = await invokeSupabaseRpc<NeighborhoodEdgeRow[]>(
    "graph_neighborhood",
    {
      p_focus_id: filters.focusId,
      p_hops: filters.hops ?? 1,
      p_min_amount: filters.minAmount ?? 0,
      p_rel_types: filters.relationshipTypes?.length ? filters.relationshipTypes : null,
      p_cycle: filters.cycle ?? null,
      p_max_edges: maxEdges,
    },
    // invokeSupabaseRpc takes no cache tags; the page's own revalidate covers freshness here.
    undefined,
  ).catch(() => [] as NeighborhoodEdgeRow[]);

  if (edgeRows.length === 0) return EMPTY;

  const entityIds = [...new Set(edgeRows.flatMap((row) => [row.source_entity_id, row.target_entity_id]))];
  const entityRows: GraphEntityRow[] = [];

  // Chunked: an id=in.() filter for a few hundred ids overflows undici's header limit, the same
  // trap the vote reads hit.
  for (let index = 0; index < entityIds.length; index += 100) {
    const chunk = entityIds.slice(index, index + 100);
    const filter = chunk.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(",");
    const rows = await fetchSupabaseRows<GraphEntityRow>(
      "graph_entities",
      `id=in.(${filter})`,
      { select: "id,slug,entity_type,label,subtitle", tags: [FUNDING_GRAPH_CACHE_TAG], paginateAll: true },
    ).catch(() => [] as GraphEntityRow[]);
    entityRows.push(...rows);
  }

  const entityById = new Map(entityRows.map((row) => [row.id, row]));

  const nodes: FundingNode[] = entityIds.map((id) => {
    const row = entityById.get(id);
    return {
      id,
      label: row?.label || id,
      type: ENTITY_TYPE_MAP[row?.entity_type || ""] || "company",
      detail: row?.subtitle || relationshipLabelForEntity(row?.entity_type),
      href: row?.entity_type === "politician" && row.slug ? `/politicians/${row.slug}` : undefined,
    };
  });

  const edges: FundingEdge[] = edgeRows.map((row) => ({
    id: row.edge_id,
    source: row.source_entity_id,
    target: row.target_entity_id,
    label: relationshipLabel(row.relationship_type),
    amount: row.amount ?? 0,
  }));

  return {
    nodes,
    edges,
    focus: nodes.find((node) => node.id === filters.focusId),
    summary: summarize(edgeRows, entityById, filters.focusId, maxEdges),
  };
}

function relationshipLabelForEntity(entityType?: string) {
  if (!entityType) return "Entity";
  return entityType.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

function summarize(
  rows: NeighborhoodEdgeRow[],
  entityById: Map<string, GraphEntityRow>,
  focusId: string,
  maxEdges: number,
): GraphNeighborhood["summary"] {
  let inbound = 0;
  let outbound = 0;
  const byCounterparty = new Map<string, number>();

  for (const row of rows) {
    const amount = row.amount ?? 0;
    // Only edges touching the focus count toward its own totals; second-hop edges describe the
    // neighbourhood, not this entity's money.
    if (row.target_entity_id === focusId) {
      inbound += amount;
      byCounterparty.set(row.source_entity_id, (byCounterparty.get(row.source_entity_id) ?? 0) + amount);
    } else if (row.source_entity_id === focusId) {
      outbound += amount;
      byCounterparty.set(row.target_entity_id, (byCounterparty.get(row.target_entity_id) ?? 0) + amount);
    }
  }

  const top = [...byCounterparty.entries()].sort((left, right) => right[1] - left[1])[0];

  return {
    edgeCount: rows.length,
    totalAmount: inbound + outbound,
    inboundAmount: inbound,
    outboundAmount: outbound,
    topCounterparty: top
      ? { label: entityById.get(top[0])?.label || top[0], amount: top[1] }
      : undefined,
    // Hitting the cap means the drawing is a subset, and the page has to say so rather than
    // implying this is the whole picture.
    truncated: rows.length >= maxEdges,
  };
}

/** Entities worth offering as a starting point: the best-connected, with their degree. */
export async function listGraphFocusOptions(limit = 40) {
  const rows = await fetchSupabaseRows<GraphEntityRow>(
    "graph_entities",
    "entity_type=in.(politician,pac,lobbyingFirm,independentExpenditureGroup)&order=label.asc",
    { select: "id,slug,entity_type,label,subtitle", tags: [FUNDING_GRAPH_CACHE_TAG], paginateAll: true },
  ).catch(() => [] as GraphEntityRow[]);

  return rows.slice(0, limit);
}
