import { searchStoredSearchDocuments } from "@/lib/supabase/search";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { emptyResult, withData } from "@/lib/data/result";
import { getLatestSyncRun } from "@/lib/supabase/sync";

const EXCERPT_LENGTH = 280;

// Bill descriptions are full CRS summaries; 24 of them made one results page 441KB.
function excerpt(text: string) {
  if (!text || text.length <= EXCERPT_LENGTH) return text;
  return `${text.slice(0, EXCERPT_LENGTH).replace(/\s+\S*$/, "")}…`;
}

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
  const [documents, latestRun] = await Promise.all([
    searchStoredSearchDocuments(normalized, normalized ? 24 : 12).catch(() => []),
    getLatestSyncRun("search_rebuild").catch(() => undefined),
  ]);
  const results = documents.map((result) => ({ ...result, description: excerpt(result.description) }));

  // Whether the index exists is a different question from whether this query matched, and unlike
  // the entity index -- which is read in full -- these results come back filtered, so an empty
  // array says nothing about the index. Reading it off the last rebuild stops a query with no
  // matches from reporting the index as missing.
  const indexed = latestRun?.status === "success" && (latestRun.record_count || 0) > 0;

  return {
    ...withData(
      indexed ? "supabase" : "unavailable",
      "search_rebuild",
      results,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: indexed ? "live" : "empty",
        detail: latestRun?.status ? `Latest rebuild status: ${latestRun.status}` : "No search rebuild history yet",
      },
    ),
    results,
  };
}
