import { emptyResult, withData } from "@/lib/data/result";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { listSyncRuns } from "@/lib/supabase/sync";

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
