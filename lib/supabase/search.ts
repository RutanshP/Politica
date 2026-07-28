import { SEARCH_CACHE_TAG } from "@/lib/supabase/cache-tags";
import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";
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

// One document is ~1KB without raw_payload, so a chunk stays well under a megabyte on the wire.
const SEARCH_DOCUMENT_CHUNK_SIZE = 500;

/**
 * Writes the new index, then prunes whatever this run did not write.
 *
 * The previous order -- delete every row, then POST all ~21k documents in a single request --
 * emptied the index outright. That one body was large enough for the edge to reject it
 * ("520 unknown_origin_error"), and because the delete had already committed, each failed rebuild
 * left the table with zero rows instead of stale ones, so global search returned nothing for every
 * query. Writing first, in chunks, keeps the previous index serving when a rebuild fails.
 *
 * The prune is by synced_at rather than by id: every row this run wrote is stamped no earlier than
 * the oldest row it built, so anything below that cutoff is left over from an earlier rebuild.
 */
export async function replaceStoredSearchDocuments(rows: SearchDocumentRow[]) {
  if (rows.length === 0) {
    await deleteSupabaseRows("search_documents", "id=not.is.null");
    return [];
  }

  await upsertSupabaseRowsInChunks("search_documents", rows, "id", SEARCH_DOCUMENT_CHUNK_SIZE);

  const cutoff = rows.reduce((oldest, row) => (row.synced_at < oldest ? row.synced_at : oldest), rows[0].synced_at);
  await deleteSupabaseRows("search_documents", `synced_at=lt.${cutoff}`);

  return [];
}
