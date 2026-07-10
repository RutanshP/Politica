import { listStoredSearchDocuments } from "@/lib/supabase/search";
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

  const [entities, latestRun] = await Promise.all([
    listStoredSearchDocuments(),
    getLatestSyncRun("search_rebuild").catch(() => undefined),
  ]);
  const normalized = query.trim().toLowerCase();

  const results = (!normalized
    ? entities.slice(0, 12)
    : entities
      .filter((entity) =>
        [entity.label, entity.title, entity.description, entity.meta]
          .join(" ")
          .toLowerCase()
          .includes(normalized),
      )
      .slice(0, 24));

  return {
    ...withData(
      entities.length > 0 ? "supabase" : "unavailable",
      "search_rebuild",
      results,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: entities.length > 0 ? "live" : "empty",
        detail: latestRun?.status ? `Latest rebuild status: ${latestRun.status}` : "No search rebuild history yet",
      },
    ),
    results,
  };
}
