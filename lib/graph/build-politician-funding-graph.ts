import "server-only";

import {
  countSourceRecordsByEdgeIds,
  getGraphEntityByPoliticianSlug,
  listCommitteesForPolitician,
  listGraphEdgesTouching,
  listGraphEntitiesByIds,
} from "@/lib/graph/funding-graph-queries";
import {
  dedupeEntities,
  enforceNodeLimit,
  filterEdgesByAmount,
  filterEdgesByCycle,
  isFinancialRelationship,
  mapEdgeRowToEdge,
  mapEntityToNode,
  pruneDisconnected,
} from "@/lib/graph/funding-graph-utils";
import { getPoliticianData, getSponsoredBillsForPolitician } from "@/lib/data/politicians";
import {
  type FundingGraphEdge,
  type FundingGraphFilters,
  type FundingGraphNode,
  type FundingGraphResponse,
  type FundingGraphTotals,
  type GraphEdgeRow,
  type GraphEntityRow,
  FUNDING_GRAPH_MAX_NODE_LIMIT,
} from "@/types/funding-graph";

const LOBBYING_RELATIONSHIPS = new Set(["retained", "lobbied_on"]);
const INDEPENDENT_RELATIONSHIPS = new Set([
  "independent_spending_support",
  "independent_spending_oppose",
]);

/**
 * Receipts-style totals derived from the money edges themselves, used when the
 * stored per-politician totals do not cover the selected cycle.
 */
export function computeTotalsFromEdges(
  edges: GraphEdgeRow[],
  entitiesById: Map<string, GraphEntityRow>,
): FundingGraphTotals {
  let individual = 0;
  let pac = 0;
  let smallDollar = 0;
  let ieSupport = 0;
  let ieOppose = 0;
  let selfFunding = 0;

  for (const edge of edges) {
    const sourceType = entitiesById.get(edge.source_entity_id)?.entity_type;
    const amount = edge.amount || 0;
    if (!amount) continue;

    if (edge.relationship_type === "independent_spending_support") { ieSupport += amount; continue; }
    if (edge.relationship_type === "independent_spending_oppose") { ieOppose += amount; continue; }
    if (edge.relationship_type !== "contributed_to" && edge.relationship_type !== "transferred_to") continue;

    if (sourceType === "donorAggregate" || sourceType === "individualDonor") {
      // The small-dollar aggregate is a labeled subset of individual giving,
      // not additional receipts on top of it.
      if ((edge.metadata as Record<string, unknown>)?.subsetOf) {
        smallDollar += amount;
        continue;
      }
      individual += amount;
    } else if (sourceType === "pac" || sourceType === "partyCommittee") {
      pac += amount;
    } else if (sourceType === "politician") {
      selfFunding += amount;
    }
  }

  const totalReceipts = individual + pac + selfFunding;
  return {
    totalReceipts,
    individualContributions: individual,
    pacContributions: pac,
    smallDollarContributions: smallDollar,
    smallDollarPercentage: individual > 0 ? Math.round((smallDollar / individual) * 1000) / 10 : 0,
    selfFunding,
    independentSupport: ieSupport,
    independentOpposition: ieOppose,
  };
}

function readStoredTotals(entity: GraphEntityRow | undefined, cycle?: number) {
  const totals = (entity?.metadata as Record<string, unknown> | undefined)?.totals as
    | (Partial<FundingGraphTotals> & { cycle?: number })
    | undefined;
  if (!totals) return undefined;
  if (cycle && totals.cycle && totals.cycle !== cycle) return undefined;
  return {
    totalReceipts: totals.totalReceipts || 0,
    individualContributions: totals.individualContributions || 0,
    pacContributions: totals.pacContributions || 0,
    smallDollarContributions: totals.smallDollarContributions || 0,
    smallDollarPercentage: totals.smallDollarPercentage || 0,
    selfFunding: totals.selfFunding || 0,
    independentSupport: totals.independentSupport || 0,
    independentOpposition: totals.independentOpposition || 0,
  } satisfies FundingGraphTotals;
}

export async function buildPoliticianFundingGraph(
  politicianSlug: string,
  filters: FundingGraphFilters,
): Promise<FundingGraphResponse | undefined> {
  const { politician } = await getPoliticianData(politicianSlug);
  if (!politician) return undefined;

  const limit = Math.min(filters.limit, FUNDING_GRAPH_MAX_NODE_LIMIT);
  const centerEntity = await getGraphEntityByPoliticianSlug(politicianSlug).catch(() => undefined);
  const centerNodeId = centerEntity?.id || `pol-${politician.id}`;

  // --- Money side: BFS over stored graph edges up to the requested depth ----
  let moneyEdgeRows: GraphEdgeRow[] = [];
  let moneyEntities: GraphEntityRow[] = [];
  if (centerEntity) {
    const seenEntityIds = new Set<string>([centerEntity.id]);
    let frontier = [centerEntity.id];
    const collectedEdges = new Map<string, GraphEdgeRow>();

    for (let level = 0; level < Math.max(1, Math.min(filters.depth, 3)); level += 1) {
      const edgeRows = await listGraphEdgesTouching(frontier).catch(() => [] as GraphEdgeRow[]);
      const nextFrontier: string[] = [];
      for (const edge of edgeRows) {
        if (!collectedEdges.has(edge.id)) collectedEdges.set(edge.id, edge);
        for (const entityId of [edge.source_entity_id, edge.target_entity_id]) {
          if (!seenEntityIds.has(entityId)) {
            seenEntityIds.add(entityId);
            nextFrontier.push(entityId);
          }
        }
      }
      if (nextFrontier.length === 0) break;
      frontier = nextFrontier;
    }

    moneyEdgeRows = [...collectedEdges.values()];
    moneyEntities = dedupeEntities(
      await listGraphEntitiesByIds([...seenEntityIds]).catch(() => [] as GraphEntityRow[]),
    );
  }

  const availableCycles = [
    ...new Set(moneyEdgeRows.map((edge) => edge.election_cycle).filter((cycle): cycle is number => cycle !== null)),
  ].sort((left, right) => right - left);

  // --- Edge-level filters --------------------------------------------------
  moneyEdgeRows = filterEdgesByCycle(moneyEdgeRows, filters.cycle);
  moneyEdgeRows = filterEdgesByAmount(moneyEdgeRows, filters.minimumAmount, filters.maximumAmount);
  if (!filters.showLobbying) {
    moneyEdgeRows = moneyEdgeRows.filter((edge) => !LOBBYING_RELATIONSHIPS.has(edge.relationship_type));
  }
  if (!filters.showIndependentExpenditures) {
    moneyEdgeRows = moneyEdgeRows.filter((edge) => !INDEPENDENT_RELATIONSHIPS.has(edge.relationship_type));
  }
  if (!filters.groupSmallDonors) {
    const smallDollarIds = new Set(
      moneyEntities
        .filter((entity) => String((entity.metadata as Record<string, unknown>)?.aggregationType || "").includes("under-$200"))
        .map((entity) => entity.id),
    );
    moneyEdgeRows = moneyEdgeRows.filter(
      (edge) => !smallDollarIds.has(edge.source_entity_id) && !smallDollarIds.has(edge.target_entity_id),
    );
  }
  if (filters.edgeTypes?.length) {
    const allowed = new Set<string>(filters.edgeTypes);
    moneyEdgeRows = moneyEdgeRows.filter((edge) => allowed.has(edge.relationship_type));
  }

  const entitiesById = new Map(moneyEntities.map((entity) => [entity.id, entity]));
  const sourceRecordCounts = await countSourceRecordsByEdgeIds(moneyEdgeRows.map((edge) => edge.id))
    .catch(() => new Map<string, number>());

  let nodes: FundingGraphNode[] = moneyEntities.map(mapEntityToNode);
  let edges: FundingGraphEdge[] = moneyEdgeRows.map((row) =>
    mapEdgeRowToEdge(row, sourceRecordCounts.get(row.id) || (row.is_aggregate ? row.transaction_count || 0 : 0)));

  // Ensure the politician node exists even with no stored money graph.
  if (!nodes.some((node) => node.id === centerNodeId)) {
    nodes.push({
      id: centerNodeId,
      data: {
        label: politician.name,
        subtitle: [politician.title, politician.district || politician.state].filter(Boolean).join(" - "),
        entityType: "politician",
      },
    });
  }

  // --- Legislative side: real stored committees, bills, issues -------------
  if (filters.showLegislative) {
    const [committees, sponsoredBills] = await Promise.all([
      listCommitteesForPolitician(politician.id).catch(() => []),
      getSponsoredBillsForPolitician(politicianSlug).catch(() => []),
    ]);

    for (const committee of committees.slice(0, 6)) {
      const nodeId = `cmte-${committee.id}`;
      nodes.push({
        id: nodeId,
        data: {
          label: committee.name,
          subtitle: committee.chamber,
          entityType: "committee",
          metadata: { href: `/committees/${committee.slug}`, role: committee.role },
        },
      });
      const chairs = /chair/i.test(committee.role);
      edges.push({
        id: `edge-member-${committee.id}`,
        source: centerNodeId,
        target: nodeId,
        data: {
          relationshipType: chairs ? "chairs" : "member_of",
          label: chairs ? "chairs" : "member of",
          isAggregate: false,
          sourceCount: 1,
        },
      });
    }

    const topBills = sponsoredBills.slice(0, 6);
    for (const bill of topBills) {
      const nodeId = `bill-${bill.id}`;
      nodes.push({
        id: nodeId,
        data: {
          label: bill.number,
          subtitle: bill.title,
          entityType: "bill",
          metadata: { href: `/bills/${bill.id}`, status: bill.status },
        },
      });
      edges.push({
        id: `edge-sponsored-${bill.id}`,
        source: centerNodeId,
        target: nodeId,
        data: { relationshipType: "sponsored", label: "sponsored", isAggregate: false, sourceCount: 1 },
      });
    }

    const topicCounts = new Map<string, number>();
    for (const bill of sponsoredBills) {
      if (bill.topic) topicCounts.set(bill.topic, (topicCounts.get(bill.topic) || 0) + 1);
    }
    const topTopics = [...topicCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3);
    for (const [topic, count] of topTopics) {
      const nodeId = `issue-${topic.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      if (nodes.some((node) => node.id === nodeId)) continue;
      nodes.push({
        id: nodeId,
        data: {
          label: topic,
          subtitle: `${count} sponsored bill${count === 1 ? "" : "s"}`,
          entityType: "issue",
        },
      });
      edges.push({
        id: `edge-issue-${nodeId}`,
        source: centerNodeId,
        target: nodeId,
        data: { relationshipType: "classified_under", label: "legislates on", isAggregate: false, sourceCount: count },
      });
    }
  }

  // --- Node-type filter, dedupe, prune, limit ------------------------------
  if (filters.nodeTypes?.length) {
    const allowed = new Set<string>([...filters.nodeTypes, "politician"]);
    nodes = nodes.filter((node) => allowed.has(node.data.entityType));
    const keptIds = new Set(nodes.map((node) => node.id));
    edges = edges.filter((edge) => keptIds.has(edge.source) && keptIds.has(edge.target));
  }

  nodes = [...new Map(nodes.map((node) => [node.id, node])).values()];
  edges = [...new Map(edges.map((edge) => [edge.id, edge])).values()];

  const prunedGraph = pruneDisconnected(centerNodeId, nodes, edges);
  const limited = enforceNodeLimit(centerNodeId, prunedGraph.nodes, prunedGraph.edges, limit);

  // --- Totals --------------------------------------------------------------
  const totals = readStoredTotals(centerEntity, filters.cycle)
    || computeTotalsFromEdges(moneyEdgeRows, entitiesById);

  const containsDemoData =
    moneyEntities.some((entity) => entity.source_system === "demo_fixture")
    || moneyEdgeRows.some((edge) => edge.source_system === "demo_fixture");

  return {
    politician: {
      id: politician.id,
      slug: politician.slug,
      name: politician.name,
      office: politician.title,
      party: politician.party,
      state: politician.state,
      district: politician.district,
    },
    centerNodeId,
    nodes: limited.nodes,
    edges: limited.edges,
    totals,
    availableFilters: {
      cycles: availableCycles,
      nodeTypes: [...new Set(limited.nodes.map((node) => node.data.entityType))],
      edgeTypes: [...new Set(limited.edges.map((edge) => edge.data.relationshipType))],
      industries: limited.nodes
        .filter((node) => node.data.entityType === "industry")
        .map((node) => node.data.label),
    },
    containsDemoData,
    truncated: limited.truncated,
    generatedAt: new Date().toISOString(),
  };
}

export function isFinancialEdge(edge: FundingGraphEdge) {
  return isFinancialRelationship(edge.data.relationshipType);
}
