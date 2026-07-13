import { emptyResult, withData } from "@/lib/data/result";
import { getStoredFinanceGraph, getStoredFinanceGraphForPolitician } from "@/lib/supabase/finance";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getLatestSyncRun } from "@/lib/supabase/sync";

export type GraphDataSource =
  | "supabase"
  | "partial"
  | "unconfigured"
  | "unavailable";

export async function getFundingGraphData(politicianSlug?: string) {
  const emptyGraph = { nodes: [], edges: [] };
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "finance_sync", emptyGraph, "unconfigured"),
      source: "unconfigured" as GraphDataSource,
      graph: emptyGraph,
    };
  }

  try {
    const [filteredGraph, latestRun] = await Promise.all([
      politicianSlug
        ? getStoredFinanceGraphForPolitician(politicianSlug)
        : getStoredFinanceGraph(),
      getLatestSyncRun("finance_sync").catch(() => undefined),
    ]);
    const source = filteredGraph.nodes.length > 0 ? "supabase" : "partial";
    const result = withData(
      source,
      "finance_sync",
      filteredGraph,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: filteredGraph.nodes.length > 0 ? "live" : "partial",
        detail: filteredGraph.nodes.length > 0
          ? "Stored finance graph available"
          : "Finance graph sync has not stored nodes yet",
      },
    );
    return { ...result, source: source as GraphDataSource, graph: filteredGraph };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "finance_sync", emptyGraph, "unavailable", error instanceof Error ? error.message : "Stored finance graph read failed"),
      source: "unavailable" as GraphDataSource,
      graph: emptyGraph,
    };
  }
}

export function getGraphSourceLabel(source: string) {
  if (source === "supabase") return "Stored finance graph";
  if (source === "partial") return "Finance graph incomplete";

  return source === "unconfigured"
    ? "Required data sources not configured"
    : "Graph data unavailable";
}

export function isLiveGraphSource(source: string) {
  return source === "supabase";
}
