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
  const read = (filter: string, rowLimit: number) =>
    fetchSupabaseRows<SearchDocumentRow>(
      "search_documents",
      [filter, "order=label.asc", `limit=${rowLimit}`].filter(Boolean).join("&"),
      { select: SEARCH_DOCUMENT_SELECT, tags: [SEARCH_CACHE_TAG] },
    );

  if (!normalized) {
    return (await read("", limit)).map(mapRowToSearchEntity);
  }

  /*
   * Name/title matches and body matches are read separately, then ranked.
   *
   * One query over all four columns, `order=label.asc&limit=24`, returned the 24 alphabetically
   * first matches of any kind. Bill labels ("HR.1234", "S.52") sort ahead of people's names, so a
   * search for a member could fill up with bills whose summaries merely mention them, and the
   * member never appeared. The body-only read is bounded because it is only a backfill.
   */
  const [named, mentioned] = await Promise.all([
    read(`or=(label.ilike.*${normalized}*,title.ilike.*${normalized}*)`, limit * 3),
    read(`or=(description.ilike.*${normalized}*,meta.ilike.*${normalized}*)`, limit),
  ]);

  const needle = normalized.toLowerCase();
  const score = (row: SearchDocumentRow, inName: boolean) => {
    const label = row.label.toLowerCase();
    return (inName ? 0 : 100)
      + (label === needle ? 0 : label.startsWith(needle) ? 1 : 2) * 10
      + (SEARCH_TYPE_RANK[row.entity_type] ?? SEARCH_TYPE_RANK.bill);
  };

  const seen = new Set<string>();
  return [
    ...named.map((row) => ({ row, rank: score(row, true) })),
    ...mentioned.map((row) => ({ row, rank: score(row, false) })),
  ]
    .sort((left, right) => left.rank - right.rank || left.row.label.localeCompare(right.row.label))
    .filter(({ row }) => {
      const key = `${row.entity_type}-${row.entity_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ row }) => mapRowToSearchEntity(row));
}

// A handful of people, committees and issues are what a name search is usually after; bills are
// the long tail.
const SEARCH_TYPE_RANK: Record<string, number> = {
  politician: 0,
  committee: 1,
  issue: 2,
  bill: 3,
  news: 4,
};

/**
 * One document by the id of the record it indexes -- a bill id, or a politician/committee/issue
 * slug. This is what /entities/[entityId] resolves through; the `entities` table it used to read
 * was a second copy of this index.
 */
export async function getStoredSearchDocumentByEntityId(entityId: string) {
  const rows = await fetchSupabaseRows<SearchDocumentRow>(
    "search_documents",
    `entity_id=eq.${encodeURIComponent(entityId)}&limit=1`,
    { select: SEARCH_DOCUMENT_SELECT, tags: [SEARCH_CACHE_TAG] },
  );
  const row = rows[0];
  return row ? mapRowToSearchEntity(row) : undefined;
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
