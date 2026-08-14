"use client";

import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
} from "@xyflow/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { FundingEdge, FundingNode } from "@/types/civic";

// Lifted toward the dark ground: the previous 600-700 weight hues went nearly black on --canvas.
const nodeColor: Record<FundingNode["type"], string> = {
  bill: "#6366f1",
  politician: "#34d399",
  committee: "#a78bfa",
  donor: "#2dd4bf",
  pac: "#fb923c",
  company: "#22d3ee",
  industry: "#60a5fa",
  "lobbying-firm": "#fb7185",
  issue: "#94a3b8",
  vote: "#818cf8",
  agency: "#fbbf24",
  state: "#7dd3fc",
};

const EDGE_STROKE = "#5c6780";

/**
 * Amounts here span six orders of magnitude -- a $2,900 individual contribution beside a $14M
 * independent expenditure. A linear scale (the previous `amount / 250000`) pinned everything above
 * $2M to the maximum and squashed everything below it to the minimum, so the drawing carried no
 * information about size at all. Log scale keeps both ends legible.
 */
function edgeWidth(amount: number) {
  if (!amount || amount <= 0) return 1;
  return Math.max(1, Math.min(Math.log10(amount) - 2, 9));
}

/**
 * Support and opposition are the most informative distinction in this data and were drawn
 * identically. They are separate relationship types upstream, so the colour is free.
 */
function edgeColor(label: string) {
  if (/oppose/i.test(label)) return "#f87171";
  if (/support/i.test(label)) return "#34d399";
  if (/retained/i.test(label)) return "#fbbf24";
  return EDGE_STROKE;
}

function formatAmount(amount: number) {
  if (!amount) return "No amount recorded";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}k`;
  return `$${amount.toLocaleString()}`;
}

export function NetworkGraph({
  nodes,
  edges,
  focusNodeId,
}: {
  nodes: FundingNode[];
  edges: FundingEdge[];
  focusNodeId?: string;
}) {
  const router = useRouter();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const normalizedNodes = useMemo(
    () =>
      nodes
        .map((node, index) => ({
          ...node,
          id: node.id?.trim() || `node-${index}`,
          label: node.label?.trim() || `Entity ${index + 1}`,
          detail: node.detail?.trim() || "Additional detail pending",
          href: node.href?.trim(),
        }))
        .filter((node, index, collection) => collection.findIndex((candidate) => candidate.id === node.id) === index),
    [nodes],
  );

  const allowedNodeIds = useMemo(
    () => new Set(normalizedNodes.map((node) => node.id)),
    [normalizedNodes],
  );

  const normalizedEdges = useMemo(
    () =>
      edges
        .map((edge, index) => ({
          ...edge,
          id: edge.id?.trim() || `edge-${index}`,
          source: edge.source?.trim() || "",
          target: edge.target?.trim() || "",
          label: edge.label?.trim() || "related to",
        }))
        .filter((edge, index, collection) => {
          if (!edge.source || !edge.target) return false;
          if (!allowedNodeIds.has(edge.source) || !allowedNodeIds.has(edge.target)) {
            return false;
          }

          return collection.findIndex((candidate) => candidate.id === edge.id) === index;
        }),
    [allowedNodeIds, edges],
  );

  const positionedNodes = useMemo(() => {
    if (!focusNodeId) {
      return normalizedNodes.map((node, index) => ({
        ...node,
        position: {
          x: 120 + (index % 3) * 240,
          y: 80 + Math.floor(index / 3) * 160,
        },
      }));
    }

    const orbiters = normalizedNodes.filter((node) => node.id !== focusNodeId);

    return normalizedNodes.map((node) => {
      if (node.id === focusNodeId) {
        return {
          ...node,
          position: { x: 360, y: 210 },
        };
      }

      const orbitIndex = orbiters.findIndex((candidate) => candidate.id === node.id);
      const angle = (orbitIndex / Math.max(orbiters.length, 1)) * Math.PI * 2;
      const radius = 220;

      return {
        ...node,
        position: {
          x: 360 + Math.cos(angle) * radius,
          y: 210 + Math.sin(angle) * radius,
        },
      };
    });
  }, [focusNodeId, normalizedNodes]);

  const flowNodes = positionedNodes.map((node) => ({
    id: node.id,
    position: node.position,
    data: {
      href: node.href,
      label: (
        <div className="min-w-[140px] rounded-[var(--r-md)] border border-[var(--line-2)] bg-[var(--panel-2)] px-3.5 py-2.5">
          <p className="text-[13px] font-semibold text-[var(--ink)]">{node.label}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{node.detail}</p>
        </div>
      ),
    },
    style: {
      borderRadius: 12,
      border: `1px solid ${nodeColor[node.type]}55`,
      background: `${nodeColor[node.type]}1f`,
    },
  }));

  const flowEdges = normalizedEdges.map((edge) => {
    const stroke = edgeColor(edge.label);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
      style: { strokeWidth: edgeWidth(edge.amount), stroke },
      labelStyle: { fill: "#8b95ad", fontSize: 11, fontWeight: 600 },
      labelBgStyle: { fill: "#111726" },
    };
  });

  const selectedEdge = normalizedEdges.find((edge) => edge.id === selectedEdgeId);
  const nodeLabelById = useMemo(
    () => new Map(normalizedNodes.map((node) => [node.id, node.label])),
    [normalizedNodes],
  );

  return (
    <div className="relative h-[520px] overflow-hidden rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--canvas)]">
      <ReactFlow
        fitView
        nodes={flowNodes}
        edges={flowEdges}
        onNodeClick={(_, node) => {
          const href = typeof node.data?.href === "string" ? node.data.href : undefined;
          if (href) router.push(href);
        }}
        onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
      >
        <MiniMap
          maskColor="rgba(10,14,23,0.7)"
          nodeColor={(node) => {
            const style = node.style as { border?: string } | undefined;
            return style?.border?.split(" ").at(-1) ?? "#6366f1";
          }}
        />
        <Controls />
        <Background gap={24} size={1} color="#1b2336" />
      </ReactFlow>
      {selectedEdge ? (
        <div className="pointer-events-none absolute bottom-4 right-4 max-w-xs rounded-[var(--r-md)] border border-[var(--line-2)] bg-[var(--panel-2)] px-3.5 py-2.5 text-xs text-[var(--muted)]">
          {/* Names and the amount, not raw entity ids -- the ids meant nothing to a reader. */}
          <p className="font-semibold text-[var(--ink)]">{formatAmount(selectedEdge.amount)}</p>
          <p className="mt-1">
            {nodeLabelById.get(selectedEdge.source) || selectedEdge.source}
            {" → "}
            {nodeLabelById.get(selectedEdge.target) || selectedEdge.target}
          </p>
          <p className="mt-1 text-[var(--faint)]">{selectedEdge.label}</p>
        </div>
      ) : null}
    </div>
  );
}
