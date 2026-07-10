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

export async function getStoredFinanceGraph() {
  const [entityRows, edgeRows] = await Promise.all([
    fetchSupabaseRows<FinanceEntityRow>("finance_entities", "order=label.asc"),
    fetchSupabaseRows<FinanceEdgeRow>("finance_edges", "order=amount.desc"),
  ]);

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
