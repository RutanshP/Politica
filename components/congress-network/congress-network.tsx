"use client";

import { Loader2, Maximize2, Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Sigma from "sigma";

import { decodeNetwork, type CongressNetwork as NetworkPayload, type CongressNetworkWire } from "@/lib/graph/congress-network-wire";
import type { PacCategory } from "@/lib/graph/pac-classification";

import {
  CATEGORY_ORDER,
  DIM_NODE_COLOR,
  buildNetworkGraph,
  computeVisibility,
  membersSharingDonors,
  type EdgeAttributes,
  type NetworkFilters,
  type NetworkGraph,
  type NodeAttributes,
  type Visibility,
} from "./network-model";
import { FilterPanel, FocusPanel, NetworkSearch } from "./network-panels";

/**
 * A translucent color for sigma's WebGL edges. Sigma blends with premultiplied alpha
 * (ONE, ONE_MINUS_SRC_ALPHA), so the RGB has to be scaled by alpha up front -- a plain
 * rgba(r, g, b, 0.02) adds full-strength RGB per edge, and thirty thousand of them turned the
 * whole network into a white blob.
 */
function translucent(hex: string, alpha: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => Math.round(((value >> shift) & 255) * alpha);
  return `rgba(${channel(16)}, ${channel(8)}, ${channel(0)}, ${alpha})`;
}

// Faint enough that ~97k of them read as structure rather than a haze over the middle.
const EDGE_REST_COLOR = translucent("#6f86b8", 0.03);
const OWNS_EDGE_COLOR = translucent("#e2e8f0", 0.9);
const PEERS_ON_CANVAS = 6;
/** Past this many neighbours, forced labels pile up; sigma's own collision-aware labels take over. */
const FORCED_LABEL_LIMIT = 28;
/** Width of the details panel that overlays the canvas's right edge on wide screens. */
const FOCUS_PANEL_PX = 380;

/** Sigma's default hover label is a white box; this one matches the dark console. */
function drawNodeHover(
  context: CanvasRenderingContext2D,
  data: { x: number; y: number; size: number; label?: string | null; color?: string },
  settings: { labelSize: number; labelFont: string },
) {
  context.beginPath();
  context.arc(data.x, data.y, data.size + 3, 0, Math.PI * 2);
  context.strokeStyle = "rgba(255,255,255,0.9)";
  context.lineWidth = 1.5;
  context.stroke();

  if (!data.label) return;
  const size = settings.labelSize;
  context.font = `600 ${size}px ${settings.labelFont}`;
  const width = context.measureText(data.label).width + 18;
  const height = size + 14;
  // Starts where sigma draws the plain label, so the box covers it rather than doubling it.
  const left = data.x + data.size + 1;
  const top = data.y - height / 2;
  context.fillStyle = "rgba(17, 23, 38, 0.96)";
  context.strokeStyle = "rgba(255, 255, 255, 0.14)";
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(left, top, width, height, 7);
  context.fill();
  context.stroke();
  context.fillStyle = "#e8edf7";
  context.fillText(data.label, left + 9, data.y + size / 3);
}

const ALL_FILTERS = (): NetworkFilters => ({
  parties: new Set(["D", "R", "I"]),
  chambers: new Set(["House", "Senate"]),
  categories: new Set(CATEGORY_ORDER),
  minAmount: 0,
});

export function CongressNetwork({
  initialFocus,
  variant = "page",
}: {
  initialFocus?: string;
  /** "embedded" sits inside a scrolling page (the member funding tab) instead of filling it. */
  variant?: "page" | "embedded";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Sigma<NodeAttributes, EdgeAttributes> | null>(null);

  const [network, setNetwork] = useState<NetworkPayload | null>(null);
  const [graph, setGraph] = useState<NetworkGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendererReady, setRendererReady] = useState(false);
  const [focus, setFocus] = useState<string | null>(initialFocus ?? null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [filters, setFilters] = useState<NetworkFilters>(ALL_FILTERS);

  const visibility = useMemo<Visibility | null>(
    () => (graph ? computeVisibility(graph, filters) : null),
    [graph, filters],
  );

  // Reducers run inside sigma's render loop, outside React, so they read these refs.
  const visibilityRef = useRef<Visibility | null>(null);
  const activeRef = useRef<string | null>(null);
  const neighborsRef = useRef<Set<string>>(new Set());
  const hoveredRef = useRef<string | null>(null);
  const peersRef = useRef<Set<string>>(new Set());

  // Focus wins. Hover previews a node only while nothing is focused; once something is, sweeping
  // the cursor across the canvas should label dots, not repaint the whole view under it.
  const active = focus ?? hovered;
  const neighbors = useMemo(() => {
    const set = new Set<string>();
    if (!graph || !active || !visibility || !graph.hasNode(active)) return set;
    graph.forEachEdge(active, (edge, _attributes, source, target) => {
      if (visibility.edges.has(edge)) set.add(source === active ? target : source);
    });
    return set;
  }, [graph, active, visibility]);

  // The members who share the most donors with a focused member, lit and labelled on the canvas
  // so the "who is this connected to" answer is visible without reading the panel.
  const peers = useMemo(() => {
    if (!graph || !focus || !visibility || !graph.hasNode(focus)) return new Set<string>();
    if (graph.getNodeAttribute(focus, "kind") !== "member") return new Set<string>();
    return new Set(membersSharingDonors(graph, focus, visibility, PEERS_ON_CANVAS).map((peer) => peer.key));
  }, [graph, focus, visibility]);

  // ---- data --------------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    fetch("/api/graph/congress-network")
      .then(async (response) => {
        if (!response.ok) throw new Error(`The network could not be loaded (${response.status}).`);
        return decodeNetwork((await response.json()) as CongressNetworkWire);
      })
      .then((payload) => {
        if (cancelled) return;
        setNetwork(payload);
        setGraph(buildNetworkGraph(payload));
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "The network could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- renderer --------------------------------------------------------------------------
  useEffect(() => {
    if (!graph || !network || !containerRef.current) return;
    let disposed = false;

    (async () => {
      // Imported here, not at module scope: sigma needs WebGL and a window, and this component is
      // rendered on the server first.
      const { default: SigmaRenderer } = await import("sigma");
      if (disposed || !containerRef.current) return;

      const renderer = new SigmaRenderer(graph, containerRef.current, {
        renderEdgeLabels: false,
        defaultEdgeColor: EDGE_REST_COLOR,
        labelColor: { color: "#dfe6f3" },
        labelFont: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
        labelSize: 12,
        labelWeight: "600",
        labelDensity: 0.5,
        labelGridCellSize: 110,
        labelRenderedSizeThreshold: 10,
        zIndex: true,
        minCameraRatio: 0.02,
        maxCameraRatio: 1.5,
        hideEdgesOnMove: true,
        defaultDrawNodeHover: drawNodeHover as never,
        nodeReducer: (node, data) => {
          const attributes = data as unknown as NodeAttributes;
          if (visibilityRef.current && !visibilityRef.current.nodes.has(node)) return { ...data, hidden: true };
          const current = activeRef.current;
          if (!current) return data;
          if (node === current) return { ...data, zIndex: 3, forceLabel: true, size: data.size * 1.3 };
          if (peersRef.current.has(node)) return { ...data, zIndex: 3, forceLabel: true, highlighted: true };
          // Whatever is under the cursor keeps its colour and label, so sigma can draw its hover card.
          if (node === hoveredRef.current) return { ...data, zIndex: 4 };
          if (neighborsRef.current.has(node)) {
            // Label the members around a focused committee; a member's 300 PACs would be noise.
            return { ...data, zIndex: 2, forceLabel: attributes.kind === "member" && neighborsRef.current.size <= FORCED_LABEL_LIMIT };
          }
          return { ...data, color: DIM_NODE_COLOR, label: "", zIndex: 0 };
        },
        edgeReducer: (edge, data) => {
          if (visibilityRef.current && !visibilityRef.current.edges.has(edge)) return { hidden: true };
          const current = activeRef.current;
          if (!current) return { color: EDGE_REST_COLOR, size: 0.5 };
          if (!graph.hasExtremity(edge, current)) return { hidden: true };
          if (data.kind === "owns") return { color: OWNS_EDGE_COLOR, size: 2, zIndex: 2 };
          const [source, target] = graph.extremities(edge);
          const committee = graph.getNodeAttributes(graph.getNodeAttribute(source, "kind") === "committee" ? source : target);
          return {
            color: translucent(committee.color, 0.55),
            size: 0.5 + Math.max(0, Math.log10(data.amount) - 2.5),
            zIndex: 1,
          };
        },
      });
      rendererRef.current = renderer;
      setRendererReady(true);

      renderer.on("clickNode", ({ node }) => setFocus(node));
      renderer.on("clickStage", () => setFocus(null));
      renderer.on("enterNode", ({ node }) => {
        setHovered(node);
        if (containerRef.current) containerRef.current.style.cursor = "pointer";
      });
      renderer.on("leaveNode", () => {
        setHovered(null);
        if (containerRef.current) containerRef.current.style.cursor = "";
      });

    })();

    return () => {
      disposed = true;
      rendererRef.current?.kill();
      rendererRef.current = null;
    };
  }, [graph, network]);

  // ---- state -> renderer -------------------------------------------------------------------
  useEffect(() => {
    visibilityRef.current = visibility;
    activeRef.current = active && graph?.hasNode(active) ? active : null;
    hoveredRef.current = hovered;
    neighborsRef.current = neighbors;
    peersRef.current = peers;
    rendererRef.current?.refresh({ skipIndexation: true });
  }, [visibility, active, hovered, neighbors, peers, graph]);

  // Frame the focused node and everything it touches, clear of the details panel.
  const frame = useCallback((keys: string[]) => {
    const renderer = rendererRef.current;
    if (!renderer || keys.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const key of keys) {
      const display = renderer.getNodeDisplayData(key);
      if (!display) continue;
      minX = Math.min(minX, display.x);
      maxX = Math.max(maxX, display.x);
      minY = Math.min(minY, display.y);
      maxY = Math.max(maxY, display.y);
    }
    if (!Number.isFinite(minX)) return;
    const ratio = Math.min(1.1, Math.max(0.05, Math.max(maxX - minX, maxY - minY) * 1.35));
    const width = containerRef.current?.clientWidth ?? 1;
    const wide = width > 1024;
    // Wide screens: the details panel covers the right edge, so shift the frame left of it.
    // Narrow screens: it is a bottom sheet over ~45% of the height, so frame the space above it.
    const panelShare = wide ? FOCUS_PANEL_PX / width : 0;
    const sheetShift = wide ? 0 : ratio * 0.3;
    renderer.getCamera().animate(
      { x: (minX + maxX) / 2 + ratio * panelShare * 0.5, y: (minY + maxY) / 2 - sheetShift, ratio: wide ? ratio : ratio * 1.25 },
      { duration: 650, easing: "cubicInOut" },
    );
  }, []);

  useEffect(() => {
    if (!focus || !graph?.hasNode(focus) || !rendererReady || !visibility) return;
    const around: string[] = [focus, ...peers];
    graph.forEachEdge(focus, (edge, _attributes, source, target) => {
      if (visibility.edges.has(edge)) around.push(source === focus ? target : source);
    });
    frame(around);
  }, [focus, graph, rendererReady, visibility, frame, peers]);

  // Deep links: ?focus=m:<bioguide> or c:<FEC committee id>.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (focus) url.searchParams.set("focus", focus);
    else url.searchParams.delete("focus");
    window.history.replaceState(null, "", url.toString());
  }, [focus]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const zoom = (factor: number) => {
    const camera = rendererRef.current?.getCamera();
    if (!camera) return;
    if (factor === 0) camera.animatedReset({ duration: 500 });
    else if (factor > 1) camera.animatedUnzoom({ duration: 250, factor });
    else camera.animatedZoom({ duration: 250, factor: 1 / factor });
  };

  const toggleCategory = (category: PacCategory) =>
    setFilters((current) => {
      const categories = new Set(current.categories);
      if (categories.has(category) && categories.size > 1) categories.delete(category);
      else categories.add(category);
      return { ...current, categories };
    });

  const focusable = graph && focus && graph.hasNode(focus) ? focus : null;

  return (
    <div
      className={`relative overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-[#070a12] ${
        variant === "page" ? "h-[calc(100dvh-7rem)] min-h-[560px]" : "h-[720px] max-h-[85dvh] min-h-[520px]"
      }`}
    >
      <div ref={containerRef} className="absolute inset-0" aria-label="Congress money network" />

      {!graph && !error ? (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading every PAC gift to Congress…
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-[var(--danger)]">{error}</div>
      ) : null}

      {graph && network && visibility ? (
        <>
          <div className="pointer-events-none absolute inset-y-3 left-3 flex w-[300px] max-w-[calc(100%-1.5rem)] flex-col gap-3">
            <NetworkSearch graph={graph} onSelect={setFocus} />
            <FilterPanel
              graph={graph}
              network={network}
              visibility={visibility}
              filters={filters}
              onChange={setFilters}
              onToggleCategory={toggleCategory}
              onReset={() => setFilters(ALL_FILTERS())}
              defaultCollapsed={variant === "embedded" || window.innerWidth < 1024}
            />
          </div>

          {focusable ? (
            <div className="absolute inset-x-2 bottom-2 h-[45%] lg:inset-x-auto lg:h-auto lg:bottom-3 lg:right-3 lg:top-3 lg:max-h-none lg:w-[380px]">
              <FocusPanel
                graph={graph}
                network={network}
                node={focusable}
                visibility={visibility}
                onFocus={setFocus}
                onClose={() => setFocus(null)}
              />
            </div>
          ) : null}

          <div className={`absolute bottom-3 flex flex-col gap-1.5 ${focusable ? "right-3 lg:right-[396px]" : "right-3"} max-lg:hidden`}>
            {[
              { label: "Zoom in", icon: Plus, factor: 0.67 },
              { label: "Zoom out", icon: Minus, factor: 1.5 },
              { label: "Show everything", icon: Maximize2, factor: 0 },
            ].map(({ label, icon: Icon, factor }) => (
              <button
                key={label}
                type="button"
                title={label}
                aria-label={label}
                onClick={() => zoom(factor)}
                className="grid h-8 w-8 place-items-center rounded-[var(--r-sm)] border border-[var(--line-2)] bg-[rgba(17,23,38,0.92)] text-[var(--muted)] transition hover:text-[var(--ink)]"
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>

          {!focusable ? (
            <div className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--line)] bg-[rgba(17,23,38,0.85)] px-3.5 py-1.5 text-xs text-[var(--muted)] md:flex">
              {/* The server layout is rotated so this is always true -- see congress-network-layout. */}
              <span className="h-2 w-2 rounded-full bg-[var(--party-d)]" /> Democrats left
              <span className="text-[var(--faint)]">·</span>
              Republicans right <span className="h-2 w-2 rounded-full bg-[var(--party-r)]" />
              <span className="text-[var(--faint)]">·</span>
              Members near each other share donors
              <span className="text-[var(--faint)]">·</span>
              Click any dot to focus
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setFocus(null)}
              className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--line-2)] bg-[rgba(17,23,38,0.92)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--ink)] max-lg:hidden"
            >
              <X className="h-3.5 w-3.5" /> Clear focus <span className="text-[var(--faint)]">Esc</span>
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}
