import { FINANCE_CACHE_TAG } from "@/lib/supabase/cache-tags";
import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";
import type { FundingEdge, FundingNode } from "@/types/civic";
import type {
  CandidateFinanceSnapshotRow,
  FinanceEdgeRow,
  FinanceEntityRow,
} from "@/types/supabase";

function mapEntityRowToNode(row: FinanceEntityRow): FundingNode {
  return {
    id: row.id,
    label: row.label,
    type: row.entity_type as FundingNode["type"],
    detail: row.detail,
    amount: row.amount || undefined,
    href: row.href || undefined,
    sourceMetadata: {
      sourceSystem: row.source_system,
      sourceId: row.source_id,
      syncedAt: row.synced_at,
      rawAvailable: Boolean(row.raw_payload),
    },
  };
}

function mapEdgeRow(row: FinanceEdgeRow): FundingEdge {
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    label: row.label,
    amount: row.amount,
    sourceMetadata: {
      sourceSystem: row.source_system,
      sourceId: row.source_id,
      syncedAt: row.synced_at,
      rawAvailable: Boolean(row.raw_payload),
    },
  };
}

const FINANCE_ENTITY_SELECT = "id,slug,label,entity_type,detail,amount,href,source_system,source_id,synced_at";
const FINANCE_EDGE_SELECT = "id,source,target,label,amount,source_system,source_id,synced_at";

export async function getStoredFinanceGraph() {
  const [entityRows, edgeRows] = await Promise.all([
    fetchSupabaseRows<FinanceEntityRow>("finance_entities", "order=label.asc", {
      select: FINANCE_ENTITY_SELECT,
      tags: [FINANCE_CACHE_TAG],
    }),
    fetchSupabaseRows<FinanceEdgeRow>("finance_edges", "order=amount.desc", {
      select: FINANCE_EDGE_SELECT,
      tags: [FINANCE_CACHE_TAG],
    }),
  ]);

  return {
    nodes: entityRows.map(mapEntityRowToNode),
    edges: edgeRows.map(mapEdgeRow),
  };
}

/**
 * The subgraph around a single politician, selected in Postgres via the finance_edges
 * source/target indexes. The caller previously fetched the entire national graph and filtered
 * it down in JS with a nodes.filter() that ran edges.some() inside it -- O(nodes x edges).
 */
export async function getStoredFinanceGraphForPolitician(politicianSlug: string) {
  const edgeRows = await fetchSupabaseRows<FinanceEdgeRow>(
    "finance_edges",
    `or=(source.eq.${encodeURIComponent(politicianSlug)},target.eq.${encodeURIComponent(politicianSlug)})&order=amount.desc`,
    { select: FINANCE_EDGE_SELECT, tags: [FINANCE_CACHE_TAG] },
  );

  const nodeIds = [
    ...new Set([politicianSlug, ...edgeRows.flatMap((row) => [row.source, row.target])].filter(Boolean)),
  ];

  if (nodeIds.length === 0) {
    return { nodes: [], edges: [] };
  }

  const quoted = nodeIds.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",");
  const entityRows = await fetchSupabaseRows<FinanceEntityRow>(
    "finance_entities",
    `id=in.(${quoted})&order=label.asc`,
    { select: FINANCE_ENTITY_SELECT, tags: [FINANCE_CACHE_TAG] },
  );

  return {
    nodes: entityRows.map(mapEntityRowToNode),
    edges: edgeRows.map(mapEdgeRow),
  };
}

export async function replaceStoredFinanceGraph(
  entityRows: FinanceEntityRow[],
  edgeRows: FinanceEdgeRow[],
  snapshotRows: CandidateFinanceSnapshotRow[],
) {
  await deleteSupabaseRows("finance_edges", "id=not.is.null");
  await deleteSupabaseRows("finance_entities", "id=not.is.null");
  await deleteSupabaseRows("candidate_finance_snapshots", "id=not.is.null");

  if (entityRows.length > 0) {
    await upsertSupabaseRows("finance_entities", entityRows, "id");
  }
  if (edgeRows.length > 0) {
    await upsertSupabaseRows("finance_edges", edgeRows, "id");
  }
  if (snapshotRows.length > 0) {
    await upsertSupabaseRows("candidate_finance_snapshots", snapshotRows, "id");
  }
}
