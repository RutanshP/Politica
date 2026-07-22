import { emptyResult, withData } from "@/lib/data/result";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getLatestSyncRun, listSyncRuns } from "@/lib/supabase/sync";

export interface SyncFreshness {
  /** e.g. "Data synced 2h ago", or a reason string when nothing has run. */
  label: string;
  detail?: string;
  tone: "ok" | "stale" | "unknown";
}

function relativeAge(iso: string) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return undefined;
  // The shell is rendered inside cached routes, so this age is a snapshot that can lag by up to
  // the route's revalidate window. Coarse units keep that lag invisible.
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 60) return { text: `${minutes}m ago`, minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 48) return { text: `${hours}h ago`, minutes };
  return { text: `${Math.round(hours / 24)}d ago`, minutes };
}

/**
 * One-line sync freshness for the sidebar. Reads the cached, tag-invalidated latest run rather
 * than listSyncRuns() -- that one is `no-store`, and calling it from the root layout would opt
 * every route in the app out of static rendering.
 */
export async function getSyncFreshness(
  pipeline = "federal_legislation_sync",
): Promise<SyncFreshness> {
  if (!isSupabaseConfigured()) {
    return { label: "Data source not configured", tone: "unknown" };
  }

  const run = await getLatestSyncRun(pipeline).catch(() => undefined);
  const timestamp = run?.finished_at || run?.started_at;
  const age = timestamp ? relativeAge(timestamp) : undefined;

  if (!run || !age) {
    return { label: "No sync recorded yet", tone: "unknown" };
  }

  const failed = run.status === "failed";
  const stale = age.minutes > 60 * 24;

  return {
    label: `Data synced ${age.text}`,
    detail: failed ? "Last run failed" : undefined,
    tone: failed || stale ? "stale" : "ok",
  };
}

export async function getSyncStatusData() {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "sync_status", [], "unconfigured"),
      runs: [],
    };
  }

  try {
    const runs = await listSyncRuns();
    const result = withData(
      runs.length > 0 ? "supabase" : "unavailable",
      "sync_status",
      runs,
      runs[0]?.finished_at || runs[0]?.started_at,
      {
        availability: runs.length > 0 ? "live" : "empty",
        detail: runs.length > 0 ? "Recent sync runs available" : "No sync runs recorded yet",
      },
    );
    return {
      ...result,
      runs,
    };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "sync_status", [], "unavailable", error instanceof Error ? error.message : "Stored sync status read failed"),
      runs: [],
    };
  }
}
