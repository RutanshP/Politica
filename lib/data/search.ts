import { searchStoredSearchDocuments } from "@/lib/supabase/search";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { emptyResult, withData } from "@/lib/data/result";
import { getLatestSyncRun } from "@/lib/supabase/sync";

export async function searchPolitica(query: string) {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "search_rebuild", [], "unconfigured"),
      results: [],
    };
  }

  const normalized = query.trim();

  // Filtered and limited in Postgres. This previously downloaded every search_documents row and
  // ran String.includes() over the whole array to return at most 24 results.
  const [results, latestRun] = await Promise.all([
    searchStoredSearchDocuments(normalized, normalized ? 24 : 12).catch(() => []),
    getLatestSyncRun("search_rebuild").catch(() => undefined),
  ]);

  return {
    ...withData(
      results.length > 0 ? "supabase" : "unavailable",
      "search_rebuild",
      results,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: results.length > 0 ? "live" : "empty",
        detail: latestRun?.status ? `Latest rebuild status: ${latestRun.status}` : "No search rebuild history yet",
      },
    ),
    results,
  };
}
