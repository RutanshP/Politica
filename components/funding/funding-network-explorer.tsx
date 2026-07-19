"use client";

import { AlertTriangle, ChevronLeft, Filter, Maximize2, Minimize2 } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FundingDetailPanel } from "@/components/funding/funding-detail-panel";
import { FundingFiltersPanel } from "@/components/funding/funding-filters-panel";
import { FundingTabs } from "@/components/funding/funding-tabs";
import { serializeFundingGraphFilters } from "@/lib/graph/funding-graph-params";
import { mapEdgeRowToEdge, mapEntityToNode } from "@/lib/graph/funding-graph-utils";
import {
  DEFAULT_FUNDING_GRAPH_FILTERS,
  FUNDING_GRAPH_EXPANDED_NODE_LIMIT,
  FUNDING_GRAPH_MAX_NODE_LIMIT,
  type FundingGraphEdge,
  type FundingGraphFilters,
  type FundingGraphNode,
  type FundingGraphResponse,
  type GraphEdgeRow,
  type GraphEntityRow,
} from "@/types/funding-graph";

const FundingGraphCanvas = dynamic(() => import("@/components/funding/funding-graph-canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-[var(--muted)]">
      Loading graph…
    </div>
  ),
});

interface NeighborsResponse {
  entity: GraphEntityRow;
  neighbors: GraphEntityRow[];
  edges: GraphEdgeRow[];
}

export function FundingNetworkExplorer({
  slug,
  initialGraph,
  initialFilters,
}: {
  slug: string;
  initialGraph: FundingGraphResponse;
  initialFilters: FundingGraphFilters;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [graph, setGraph] = useState(initialGraph);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>();
  const [showAmounts, setShowAmounts] = useState(true);
  const [animateEdges, setAnimateEdges] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<{ nodes: FundingGraphNode[]; edges: FundingGraphEdge[] }>({ nodes: [], edges: [] });
  const [localCenter, setLocalCenter] = useState<{ graph: { nodes: FundingGraphNode[]; edges: FundingGraphEdge[] }; centerId: string; label: string } | undefined>();

  const initialSerialized = useRef(serializeFundingGraphFilters(initialFilters).toString());

  // Refetch (and mirror filters into the URL) whenever filters change.
  useEffect(() => {
    const serialized = serializeFundingGraphFilters(filters).toString();
    if (serialized === initialSerialized.current) return;
    initialSerialized.current = serialized;

    router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false });

    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetch(`/api/politicians/${encodeURIComponent(slug)}/funding-graph?${serialized}`)
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error || `Request failed (${response.status})`);
        return response.json() as Promise<FundingGraphResponse>;
      })
      .then((next) => {
        if (cancelled) return;
        setGraph(next);
        setExpandedNodes({ nodes: [], edges: [] });
        setLocalCenter(undefined);
        setSelectedNodeId(undefined);
        setSelectedEdgeId(undefined);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Failed to load graph");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, pathname, router, slug]);

  // The displayed graph: recentered view, or base graph + expansions.
  const display = useMemo(() => {
    if (localCenter) return { ...localCenter.graph, centerId: localCenter.centerId };

    const nodes = [...graph.nodes];
    const nodeIds = new Set(nodes.map((node) => node.id));
    for (const node of expandedNodes.nodes) {
      if (!nodeIds.has(node.id) && nodes.length < FUNDING_GRAPH_MAX_NODE_LIMIT) {
        nodes.push(node);
        nodeIds.add(node.id);
      }
    }
    const edges = [...graph.edges];
    const edgeIds = new Set(edges.map((edge) => edge.id));
    for (const edge of expandedNodes.edges) {
      if (!edgeIds.has(edge.id) && nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
        edges.push(edge);
        edgeIds.add(edge.id);
      }
    }
    return { nodes, edges, centerId: graph.centerNodeId };
  }, [expandedNodes, graph, localCenter]);

  const nodesById = useMemo(
    () => new Map(display.nodes.map((node) => [node.id, node])),
    [display.nodes],
  );
  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) : undefined;
  const selectedEdge = selectedEdgeId
    ? display.edges.find((edge) => edge.id === selectedEdgeId)
    : undefined;

  const expandDisabled = display.nodes.length >= FUNDING_GRAPH_EXPANDED_NODE_LIMIT;

  const fetchNeighbors = useCallback(
    async (entityId: string, exclude: string[]) => {
      const params = new URLSearchParams({ exclude: exclude.join(","), limit: "12" });
      const response = await fetch(`/api/graph/entities/${encodeURIComponent(entityId)}/neighbors?${params}`);
      if (!response.ok) throw new Error("Expansion failed");
      return (await response.json()) as NeighborsResponse;
    },
    [],
  );

  const handleExpandNode = useCallback(
    async (nodeId: string) => {
      try {
        const payload = await fetchNeighbors(nodeId, display.nodes.map((node) => node.id));
        setExpandedNodes((current) => ({
          nodes: [...current.nodes, ...payload.neighbors.map(mapEntityToNode)],
          edges: [
            ...current.edges,
            ...payload.edges.map((edge) => mapEdgeRowToEdge(edge, edge.transaction_count || 0)),
          ],
        }));
      } catch {
        setError("Could not expand this node.");
      }
    },
    [display.nodes, fetchNeighbors],
  );

  const handleMakeCenter = useCallback(
    async (nodeId: string) => {
      try {
        const payload = await fetchNeighbors(nodeId, []);
        const nodes = [mapEntityToNode(payload.entity), ...payload.neighbors.map(mapEntityToNode)];
        setLocalCenter({
          centerId: nodeId,
          label: payload.entity.label,
          graph: {
            nodes,
            edges: payload.edges.map((edge) => mapEdgeRowToEdge(edge, edge.transaction_count || 0)),
          },
        });
        setSelectedNodeId(undefined);
        setSelectedEdgeId(undefined);
      } catch {
        setError("Could not recenter on this entity.");
      }
    },
    [fetchNeighbors],
  );

  const clearSelection = useCallback(() => {
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
  }, []);

  const canvas = (
    <FundingGraphCanvas
      centerNodeId={display.centerId}
      nodes={display.nodes}
      edges={display.edges}
      selectedNodeId={selectedNodeId}
      selectedEdgeId={selectedEdgeId}
      showAmounts={showAmounts}
      animateEdges={animateEdges}
      onSelectNode={(nodeId) => {
        setSelectedNodeId(nodeId);
        setSelectedEdgeId(undefined);
      }}
      onSelectEdge={(edgeId) => {
        setSelectedEdgeId(edgeId);
        setSelectedNodeId(undefined);
      }}
      onClearSelection={clearSelection}
    />
  );

  return (
    <div className="space-y-4">
      {graph.containsDemoData ? (
        <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-800">
          <AlertTriangle size={14} className="shrink-0" />
          Demo graph: some entities, relationships, and monetary values are illustrative placeholders.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_300px]">
        {/* Filters: drawer on mobile, panel on desktop */}
        <details className="rounded-[28px] border border-white/60 bg-[var(--panel)] shadow-[0_20px_60px_rgba(15,23,42,0.08)] xl:hidden">
          <summary className="flex cursor-pointer items-center gap-2 px-5 py-3 text-sm font-semibold text-[var(--ink)]">
            <Filter size={14} /> Filters
          </summary>
          <div className="px-5 pb-5">
            <FundingFiltersPanel
              filters={filters}
              availableCycles={graph.availableFilters.cycles}
              showAmounts={showAmounts}
              animateEdges={animateEdges}
              onChange={(next) => setFilters((current) => ({ ...current, ...next }))}
              onDisplayChange={({ showAmounts: nextAmounts, animateEdges: nextAnimate }) => {
                if (nextAmounts !== undefined) setShowAmounts(nextAmounts);
                if (nextAnimate !== undefined) setAnimateEdges(nextAnimate);
              }}
              onReset={() => setFilters(DEFAULT_FUNDING_GRAPH_FILTERS)}
            />
          </div>
        </details>
        <aside className="hidden rounded-[28px] border border-white/60 bg-[var(--panel)] p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] xl:block">
          <FundingFiltersPanel
            filters={filters}
            availableCycles={graph.availableFilters.cycles}
            showAmounts={showAmounts}
            animateEdges={animateEdges}
            onChange={(next) => setFilters((current) => ({ ...current, ...next }))}
            onDisplayChange={({ showAmounts: nextAmounts, animateEdges: nextAnimate }) => {
              if (nextAmounts !== undefined) setShowAmounts(nextAmounts);
              if (nextAnimate !== undefined) setAnimateEdges(nextAnimate);
            }}
            onReset={() => setFilters(DEFAULT_FUNDING_GRAPH_FILTERS)}
          />
        </aside>

        {/* Graph canvas */}
        <div
          className={
            fullscreen
              ? "fixed inset-0 z-50 bg-[var(--canvas)] p-4"
              : "relative h-[560px] overflow-hidden rounded-[28px] border border-white/60 bg-[linear-gradient(180deg,_rgba(248,250,252,0.9)_0%,_rgba(241,245,249,0.95)_100%)] shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
          }
        >
          <div className={fullscreen ? "relative h-full overflow-hidden rounded-[28px] border border-[var(--line)] bg-white" : "h-full"}>
            <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
              {localCenter ? (
                <button
                  type="button"
                  onClick={() => setLocalCenter(undefined)}
                  className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--accent)] shadow-sm"
                >
                  <ChevronLeft size={13} /> Back to {graph.politician.name}
                </button>
              ) : null}
              {loading ? (
                <span className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-[var(--muted)] shadow-sm">
                  Updating…
                </span>
              ) : null}
              {graph.truncated && !localCenter ? (
                <span className="rounded-full bg-white/90 px-3 py-1.5 text-[10px] font-semibold text-[var(--muted)] shadow-sm">
                  Showing top {display.nodes.length} relationships — refine filters for more
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setFullscreen((current) => !current)}
              className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink)] shadow-sm"
            >
              {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              {fullscreen ? "Exit full screen" : "Full screen"}
            </button>
            {canvas}
          </div>
        </div>

        {/* Detail panel */}
        <aside className="rounded-[28px] border border-white/60 bg-[var(--panel)] p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          <FundingDetailPanel
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            nodesById={nodesById}
            edges={display.edges}
            totals={graph.totals}
            centerNodeId={display.centerId}
            onClose={clearSelection}
            onExpandNode={handleExpandNode}
            onMakeCenter={handleMakeCenter}
            expandDisabled={expandDisabled}
          />
        </aside>
      </div>

      <div className="rounded-[28px] border border-white/60 bg-[var(--panel)] shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <FundingTabs
          nodes={display.nodes}
          edges={display.edges}
          totals={graph.totals}
          onSelectEdge={(edgeId) => {
            setSelectedEdgeId(edgeId);
            setSelectedNodeId(undefined);
          }}
          onSelectNode={(nodeId) => {
            setSelectedNodeId(nodeId);
            setSelectedEdgeId(undefined);
          }}
        />
      </div>
    </div>
  );
}
