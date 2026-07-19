"use client";

import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { Crosshair, Download } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { fundingNodeTypes } from "@/components/funding/funding-graph-nodes";
import { formatMoney, getEdgeTheme, getEntityTheme } from "@/components/funding/funding-graph-theme";
import { layoutFundingGraph } from "@/lib/graph/funding-graph-layout";
import {
  FINANCIAL_RELATIONSHIP_TYPES,
  type FundingGraphEdge,
  type FundingGraphEntityType,
  type FundingGraphNode,
} from "@/types/funding-graph";

const ZOOMED_OUT_THRESHOLD = 0.55;

export interface FundingGraphCanvasProps {
  centerNodeId: string;
  nodes: FundingGraphNode[];
  edges: FundingGraphEdge[];
  selectedNodeId?: string;
  selectedEdgeId?: string;
  showAmounts: boolean;
  animateEdges: boolean;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onClearSelection: () => void;
}

function exportGraphCsv(nodes: FundingGraphNode[], edges: FundingGraphEdge[]) {
  const quote = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [
    "kind,id,label_or_relationship,entity_type,source,target,amount,transactions,cycle,is_aggregate",
    ...nodes.map((node) =>
      ["node", node.id, node.data.label, node.data.entityType, "", "", node.data.amount ?? "", node.data.transactionCount ?? "", node.data.electionCycle ?? "", node.data.isAggregate ?? false].map(quote).join(",")),
    ...edges.map((edge) =>
      ["edge", edge.id, edge.data.relationshipType, "", edge.source, edge.target, edge.data.amount ?? "", edge.data.transactionCount ?? "", edge.data.electionCycle ?? "", edge.data.isAggregate].map(quote).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "funding-graph.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function CanvasInner({
  centerNodeId,
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  showAmounts,
  animateEdges,
  onSelectNode,
  onSelectEdge,
  onClearSelection,
}: FundingGraphCanvasProps) {
  const { fitView } = useReactFlow();
  const [zoomedOut, setZoomedOut] = useState(false);

  const connectedToSelection = useMemo(() => {
    if (!selectedNodeId) return undefined;
    const connected = new Set<string>([selectedNodeId]);
    for (const edge of edges) {
      if (edge.source === selectedNodeId) connected.add(edge.target);
      if (edge.target === selectedNodeId) connected.add(edge.source);
    }
    return connected;
  }, [edges, selectedNodeId]);

  // Layout depends only on the node/edge sets -- selection changes reuse it.
  const positioned = useMemo(
    () => layoutFundingGraph(centerNodeId, nodes, edges),
    [centerNodeId, nodes, edges],
  );

  const flowNodes: Node[] = useMemo(
    () =>
      positioned.map((node) => ({
        id: node.id,
        type: node.data.entityType === "politician" && node.id === centerNodeId ? "politician" : "entity",
        position: node.position,
        data: {
          ...node.data,
          selected: node.id === selectedNodeId,
          dimmed: connectedToSelection ? !connectedToSelection.has(node.id) : false,
          zoomedOut: node.id === centerNodeId ? false : zoomedOut,
        },
      })),
    [centerNodeId, connectedToSelection, positioned, selectedNodeId, zoomedOut],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((edge) => {
        const theme = getEdgeTheme(edge.data.relationshipType, edge.data.isAggregate);
        const isFinancial = (FINANCIAL_RELATIONSHIP_TYPES as readonly string[]).includes(edge.data.relationshipType);
        const isSelected = edge.id === selectedEdgeId;
        const dimmed = connectedToSelection
          ? !(connectedToSelection.has(edge.source) && connectedToSelection.has(edge.target))
          : false;
        const strokeWidth = isFinancial && edge.data.amount
          ? Math.max(1.6, Math.min(edge.data.amount / 90000, 7))
          : 1.4;

        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          animated: animateEdges && isFinancial,
          label: showAmounts && !zoomedOut && edge.data.amount ? formatMoney(edge.data.amount) : undefined,
          labelStyle: { fill: theme.stroke, fontSize: 10, fontWeight: 700 },
          labelBgStyle: { fill: "#ffffff", fillOpacity: 0.85 },
          markerEnd: { type: MarkerType.ArrowClosed, color: theme.stroke, width: 16, height: 16 },
          style: {
            stroke: theme.stroke,
            strokeWidth: isSelected ? strokeWidth + 1.5 : strokeWidth,
            strokeDasharray: theme.dash,
            opacity: dimmed ? 0.15 : isSelected ? 1 : 0.85,
          },
        } satisfies Edge;
      }),
    [animateEdges, connectedToSelection, edges, selectedEdgeId, showAmounts, zoomedOut],
  );

  const handleMove = useCallback(
    (_event: unknown, viewport: { zoom: number }) => {
      setZoomedOut(viewport.zoom < ZOOMED_OUT_THRESHOLD);
    },
    [],
  );

  return (
    <ReactFlow
      fitView
      minZoom={0.2}
      maxZoom={1.8}
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={fundingNodeTypes}
      nodesConnectable={false}
      onMove={handleMove}
      onNodeClick={(_, node) => onSelectNode(node.id)}
      onEdgeClick={(_, edge) => onSelectEdge(edge.id)}
      onPaneClick={onClearSelection}
      proOptions={{ hideAttribution: true }}
    >
      <MiniMap
        pannable
        zoomable
        nodeColor={(node) =>
          getEntityTheme(
            (node.data as { entityType?: FundingGraphEntityType }).entityType || "issue",
          ).color}
        className="!h-24 !w-36 rounded-xl border border-[var(--line)]"
      />
      <Controls showInteractive={false} />
      <Background gap={26} size={1.2} color="#d9e1ef" />
      <Panel position="top-right" className="flex gap-2">
        <button
          type="button"
          onClick={() => fitView({ padding: 0.15, duration: 300 })}
          className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink)] shadow-sm hover:bg-slate-50"
        >
          <Crosshair size={13} /> Fit view
        </button>
        <button
          type="button"
          onClick={() => exportGraphCsv(nodes, edges)}
          className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink)] shadow-sm hover:bg-slate-50"
        >
          <Download size={13} /> CSV
        </button>
      </Panel>
    </ReactFlow>
  );
}

export default function FundingGraphCanvas(props: FundingGraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
