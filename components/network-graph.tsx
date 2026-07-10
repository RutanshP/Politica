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

const nodeColor: Record<FundingNode["type"], string> = {
  bill: "#1d4ed8",
  politician: "#16a34a",
  committee: "#7c3aed",
  donor: "#0f766e",
  pac: "#ea580c",
  company: "#0f766e",
  industry: "#2563eb",
  "lobbying-firm": "#be123c",
  issue: "#475569",
  vote: "#1f2937",
  agency: "#a16207",
  state: "#0f172a",
};

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
        <div className="min-w-[140px] rounded-2xl border border-white/60 bg-white px-4 py-3 shadow-[0_20px_50px_rgba(15,23,42,0.12)]">
          <p className="text-sm font-semibold text-[var(--ink)]">{node.label}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{node.detail}</p>
        </div>
      ),
    },
    style: {
      borderRadius: 16,
      border: `1px solid ${nodeColor[node.type]}33`,
      background: `${nodeColor[node.type]}12`,
    },
  }));

  const flowEdges = normalizedEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
    style: {
      strokeWidth: Math.max(2, Math.min(edge.amount / 250000, 8)),
      stroke: "#94a3b8",
    },
    labelStyle: { fill: "#475569", fontSize: 11, fontWeight: 600 },
  }));

  const selectedEdge = normalizedEdges.find((edge) => edge.id === selectedEdgeId);

  return (
    <div className="relative h-[520px] overflow-hidden rounded-[28px] border border-[var(--line)] bg-[linear-gradient(180deg,_rgba(248,250,252,0.8)_0%,_rgba(241,245,249,0.9)_100%)]">
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
        <MiniMap />
        <Controls />
        <Background gap={24} size={1} color="#d9e1ef" />
      </ReactFlow>
      {selectedEdge ? (
        <div className="pointer-events-none absolute bottom-4 right-4 max-w-xs rounded-2xl border border-white/70 bg-white/95 px-4 py-3 text-xs text-[var(--muted)] shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
          <p className="font-semibold text-[var(--ink)]">Relationship detail</p>
          <p className="mt-1">
            {selectedEdge.source} - {selectedEdge.label} - {selectedEdge.target}
          </p>
        </div>
      ) : null}
    </div>
  );
}
