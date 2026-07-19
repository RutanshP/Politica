import {
  LEGISLATIVE_ENTITY_TYPES,
  MONEY_ENTITY_TYPES,
  type FundingGraphEdge,
  type FundingGraphNode,
} from "@/types/funding-graph";

export interface PositionedNode extends FundingGraphNode {
  position: { x: number; y: number };
}

const COLUMN_X: Record<string, number> = {
  "money-outer": -840,
  money: -420,
  center: 0,
  legislative: 460,
};

const ROW_HEIGHT = 96;

/**
 * Deterministic layered layout: money entities on the left, the politician
 * (and their candidate committees) in the center column, legislative entities
 * on the right. Second-degree money entities (companies behind employee
 * aggregates, lobbying firms) sit one column further left. Within a column,
 * nodes are ordered by financial weight so the heaviest edges stay visually
 * shortest. Selection never re-runs this -- positions depend only on the
 * node/edge sets.
 */
export function layoutFundingGraph(
  centerNodeId: string,
  nodes: FundingGraphNode[],
  edges: FundingGraphEdge[],
): PositionedNode[] {
  const adjacentToCenter = new Set<string>();
  const candidateCommitteeIds = new Set(
    nodes.filter((node) => node.data.entityType === "candidateCommittee").map((node) => node.id),
  );
  for (const edge of edges) {
    if (edge.source === centerNodeId) adjacentToCenter.add(edge.target);
    if (edge.target === centerNodeId) adjacentToCenter.add(edge.source);
    for (const committeeId of candidateCommitteeIds) {
      if (edge.source === committeeId) adjacentToCenter.add(edge.target);
      if (edge.target === committeeId) adjacentToCenter.add(edge.source);
    }
  }

  const weightByNode = new Map<string, number>();
  for (const edge of edges) {
    const amount = edge.data.amount || 0;
    for (const nodeId of [edge.source, edge.target]) {
      weightByNode.set(nodeId, Math.max(weightByNode.get(nodeId) || 0, amount));
    }
  }

  const columns: Record<string, FundingGraphNode[]> = {
    "money-outer": [],
    money: [],
    center: [],
    legislative: [],
  };

  for (const node of nodes) {
    if (node.id === centerNodeId || node.data.entityType === "candidateCommittee") {
      columns.center.push(node);
    } else if ((MONEY_ENTITY_TYPES as readonly string[]).includes(node.data.entityType)) {
      columns[adjacentToCenter.has(node.id) ? "money" : "money-outer"].push(node);
    } else if ((LEGISLATIVE_ENTITY_TYPES as readonly string[]).includes(node.data.entityType)) {
      columns.legislative.push(node);
    } else {
      columns.money.push(node);
    }
  }

  const positioned: PositionedNode[] = [];
  for (const [columnKey, columnNodes] of Object.entries(columns)) {
    const ordered = [...columnNodes].sort((left, right) => {
      // Keep the politician itself first in the center column.
      if (left.id === centerNodeId) return -1;
      if (right.id === centerNodeId) return 1;
      return (weightByNode.get(right.id) || 0) - (weightByNode.get(left.id) || 0);
    });

    const columnHeight = (ordered.length - 1) * ROW_HEIGHT;
    ordered.forEach((node, index) => {
      const isCenterPolitician = node.id === centerNodeId;
      positioned.push({
        ...node,
        position: {
          x: COLUMN_X[columnKey],
          y: isCenterPolitician
            ? 0
            : index * ROW_HEIGHT - columnHeight / 2 + (columnKey === "center" ? ROW_HEIGHT * 1.6 : 0),
        },
      });
    });
  }

  return positioned;
}
