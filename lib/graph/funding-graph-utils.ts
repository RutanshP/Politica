import {
  FINANCIAL_RELATIONSHIP_TYPES,
  type FundingGraphEdge,
  type FundingGraphEntityType,
  type FundingGraphNode,
  type FundingGraphRelationshipType,
  type GraphEdgeRow,
  type GraphEntityRow,
} from "@/types/funding-graph";

export function isFinancialRelationship(type: string) {
  return (FINANCIAL_RELATIONSHIP_TYPES as readonly string[]).includes(type);
}

const EDGE_LABELS: Record<FundingGraphRelationshipType, string> = {
  contributed_to: "contributed to",
  transferred_to: "transferred to",
  supports: "supports",
  opposes: "opposes",
  independent_spending_support: "independent spending supporting",
  independent_spending_oppose: "independent spending opposing",
  employee_contributions: "associated employee contributions",
  industry_contributions: "industry-classified contributions",
  employed_by: "employed by",
  affiliated_with: "affiliated with",
  retained: "retained",
  lobbied_on: "lobbied on",
  member_of: "member of",
  chairs: "chairs",
  sponsored: "sponsored",
  cosponsored: "cosponsored",
  voted_on: "voted on",
  considered: "considered",
  classified_under: "classified under",
  affected_by: "advocates on",
};

export function formatRelationshipLabel(type: FundingGraphRelationshipType, isAggregate: boolean) {
  const base = EDGE_LABELS[type] || type.replace(/_/g, " ");
  // Aggregate money labels must read as aggregates, never as direct gifts.
  if (isAggregate && type === "contributed_to") return "aggregated contributions";
  return base;
}

/**
 * Ranking for financial edges: amount, then transaction count, then recency,
 * then directness (direct before aggregate), then source confidence.
 */
export function rankFinancialEdges(edges: GraphEdgeRow[]) {
  return [...edges].sort((left, right) =>
    (right.amount || 0) - (left.amount || 0)
    || (right.transaction_count || 0) - (left.transaction_count || 0)
    || Date.parse(right.occurred_at || "1970-01-01") - Date.parse(left.occurred_at || "1970-01-01")
    || Number(left.is_aggregate) - Number(right.is_aggregate)
    || (right.confidence ?? 0) - (left.confidence ?? 0));
}

/**
 * Cycle filter: financial edges must match the requested cycle; structural
 * edges (affiliations, memberships) are kept regardless of any cycle stamped
 * on them, so the graph stays connected across cycles.
 */
export function filterEdgesByCycle(edges: GraphEdgeRow[], cycle?: number) {
  if (!cycle) return edges;
  return edges.filter((edge) =>
    !isFinancialRelationship(edge.relationship_type)
    || edge.election_cycle === null
    || edge.election_cycle === cycle);
}

/** Amount bounds apply only to edges that carry an amount. */
export function filterEdgesByAmount(edges: GraphEdgeRow[], minimum?: number, maximum?: number) {
  return edges.filter((edge) => {
    if (edge.amount === null || edge.amount === undefined) return true;
    if (minimum !== undefined && edge.amount < minimum) return false;
    if (maximum !== undefined && edge.amount > maximum) return false;
    return true;
  });
}

export function dedupeEntities(entities: GraphEntityRow[]) {
  return [...new Map(entities.map((entity) => [entity.id, entity])).values()];
}

/**
 * Keeps only nodes reachable from the center through the surviving edges, so
 * filtered-out branches do not leave floating orphan nodes.
 */
export function pruneDisconnected(
  centerId: string,
  nodes: FundingGraphNode[],
  edges: FundingGraphEdge[],
) {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) || []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) || []), edge.source]);
  }

  const reachable = new Set<string>([centerId]);
  const queue = [centerId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adjacency.get(current) || []) {
      if (!reachable.has(neighbor)) {
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  const keptNodes = nodes.filter((node) => reachable.has(node.id));
  const keptIds = new Set(keptNodes.map((node) => node.id));
  const keptEdges = edges.filter((edge) => keptIds.has(edge.source) && keptIds.has(edge.target));
  return { nodes: keptNodes, edges: keptEdges };
}

/**
 * Enforces the node budget. The center and candidate committees are always
 * kept; remaining nodes are ranked by their strongest financial connection
 * (amount desc, then transaction count), with legislative nodes ranked after
 * financial ones at equal weight.
 */
export function enforceNodeLimit(
  centerId: string,
  nodes: FundingGraphNode[],
  edges: FundingGraphEdge[],
  limit: number,
) {
  if (nodes.length <= limit) {
    return { nodes, edges, truncated: false };
  }

  const weightByNode = new Map<string, { amount: number; transactions: number }>();
  for (const edge of edges) {
    for (const nodeId of [edge.source, edge.target]) {
      const current = weightByNode.get(nodeId) || { amount: 0, transactions: 0 };
      weightByNode.set(nodeId, {
        amount: Math.max(current.amount, edge.data.amount || 0),
        transactions: Math.max(current.transactions, edge.data.transactionCount || 0),
      });
    }
  }

  const pinned = new Set(
    nodes
      .filter((node) => node.id === centerId || node.data.entityType === "candidateCommittee")
      .map((node) => node.id),
  );

  const ranked = nodes
    .filter((node) => !pinned.has(node.id))
    .sort((left, right) => {
      const leftWeight = weightByNode.get(left.id) || { amount: 0, transactions: 0 };
      const rightWeight = weightByNode.get(right.id) || { amount: 0, transactions: 0 };
      return rightWeight.amount - leftWeight.amount
        || rightWeight.transactions - leftWeight.transactions;
    });

  const budget = Math.max(limit - pinned.size, 0);
  const keptIds = new Set([...pinned, ...ranked.slice(0, budget).map((node) => node.id)]);
  const keptNodes = nodes.filter((node) => keptIds.has(node.id));
  const keptEdges = edges.filter((edge) => keptIds.has(edge.source) && keptIds.has(edge.target));
  const pruned = pruneDisconnected(centerId, keptNodes, keptEdges);

  return { nodes: pruned.nodes, edges: pruned.edges, truncated: true };
}

export function toEntityType(value: string): FundingGraphEntityType {
  return value as FundingGraphEntityType;
}

export function toRelationshipType(value: string): FundingGraphRelationshipType {
  return value as FundingGraphRelationshipType;
}

export function mapEntityToNode(entity: GraphEntityRow): FundingGraphNode {
  const metadata = (entity.metadata || {}) as Record<string, unknown>;
  return {
    id: entity.id,
    data: {
      label: entity.label,
      subtitle: entity.subtitle || undefined,
      entityType: toEntityType(entity.entity_type),
      imageUrl: entity.image_url || undefined,
      isAggregate: entity.entity_type === "donorAggregate"
        || entity.entity_type === "industry"
        || Boolean(metadata.aggregationType),
      metadata: Object.fromEntries(
        Object.entries(metadata).filter(([, value]) =>
          ["string", "number", "boolean"].includes(typeof value) || value === null,
        ),
      ) as Record<string, string | number | boolean | null>,
    },
  };
}

export function mapEdgeRowToEdge(row: GraphEdgeRow, sourceCount: number): FundingGraphEdge {
  const relationshipType = toRelationshipType(row.relationship_type);
  return {
    id: row.id,
    source: row.source_entity_id,
    target: row.target_entity_id,
    data: {
      relationshipType,
      label: formatRelationshipLabel(relationshipType, row.is_aggregate),
      amount: row.amount ?? undefined,
      transactionCount: row.transaction_count ?? undefined,
      electionCycle: row.election_cycle ?? undefined,
      occurredAt: row.occurred_at ?? undefined,
      isAggregate: row.is_aggregate,
      sourceCount,
      sourceUrl: row.source_url ?? undefined,
    },
  };
}
