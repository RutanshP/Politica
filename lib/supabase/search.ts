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

export async function listStoredSearchDocuments() {
  const rows = await fetchSupabaseRows<SearchDocumentRow>("search_documents", "order=label.asc");
  return rows.map(mapRowToSearchEntity);
}

export async function replaceStoredSearchDocuments(rows: SearchDocumentRow[]) {
  await deleteSupabaseRows("search_documents", "id=not.is.null");
  if (rows.length === 0) {
    return [];
  }
  return upsertSupabaseRows("search_documents", rows, "id");
}
