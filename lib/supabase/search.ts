import { SEARCH_CACHE_TAG } from "@/lib/supabase/cache-tags";
import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";
import type { SearchEntity } from "@/types/civic";
import type { SearchDocumentRow } from "@/types/supabase";

function mapRowToSearchEntity(row: SearchDocumentRow): SearchEntity {
  return {
    id: row.entity_id,
    type: row.entity_type as SearchEntity["type"],
    label: row.label,
    title: row.title,
    description: row.description,
    href: row.href,
    meta: row.meta,
    sourceMetadata: {
      sourceSystem: row.source_system,
      sourceId: row.source_id,
      syncedAt: row.synced_at,
      rawAvailable: Boolean(row.raw_payload),
    },
  };
}

const SEARCH_DOCUMENT_SELECT = "entity_id,entity_type,label,title,description,href,meta,source_system,source_id,synced_at";

function escapeIlikeValue(value: string) {
  return value.replace(/[%*,()]/g, " ").trim();
}

/**
 * Searches server-side against the trigram index instead of downloading every search document
 * and substring-matching in JS.
 */
export async function searchStoredSearchDocuments(query: string, limit: number) {
  const normalized = escapeIlikeValue(query.trim());

  const filters = normalized
    ? [`or=(label.ilike.*${normalized}*,title.ilike.*${normalized}*,description.ilike.*${normalized}*,meta.ilike.*${normalized}*)`]
    : [];

  const rows = await fetchSupabaseRows<SearchDocumentRow>(
    "search_documents",
    [...filters, "order=label.asc", `limit=${limit}`].join("&"),
    { select: SEARCH_DOCUMENT_SELECT, tags: [SEARCH_CACHE_TAG] },
  );

  return rows.map(mapRowToSearchEntity);
}

export async function listStoredSearchDocuments() {
  const rows = await fetchSupabaseRows<SearchDocumentRow>("search_documents", "order=label.asc", {
    select: SEARCH_DOCUMENT_SELECT,
    tags: [SEARCH_CACHE_TAG],
  });
  return rows.map(mapRowToSearchEntity);
}

export async function replaceStoredSearchDocuments(rows: SearchDocumentRow[]) {
  await deleteSupabaseRows("search_documents", "id=not.is.null");
  if (rows.length === 0) {
    return [];
  }
  return upsertSupabaseRows("search_documents", rows, "id");
}
