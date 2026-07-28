import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";
import type { SearchEntity } from "@/types/civic";
import type { EntityRelationshipRow, EntityRow } from "@/types/supabase";

// Excludes raw_payload -- mapRowToEntity only ever checks it with Boolean(), never reads its contents.
const ENTITY_SELECT = "id,entity_type,label,title,description,href,meta,source_system,source_id,synced_at";

function mapRowToEntity(row: EntityRow): SearchEntity {
  return {
    id: row.id,
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

export async function listStoredEntities() {
  const rows = await fetchSupabaseRows<EntityRow>("entities", "order=label.asc", { select: ENTITY_SELECT });
  return rows.map(mapRowToEntity);
}

export async function getStoredEntity(entityId: string) {
  const rows = await fetchSupabaseRows<EntityRow>(
    "entities",
    `id=eq.${encodeURIComponent(entityId)}&limit=1`,
    { select: ENTITY_SELECT },
  );
  const row = rows[0];
  return row ? mapRowToEntity(row) : undefined;
}

const ENTITY_CHUNK_SIZE = 500;

function oldestSyncedAt(rows: { synced_at: string }[]) {
  return rows.reduce((oldest, row) => (row.synced_at < oldest ? row.synced_at : oldest), rows[0].synced_at);
}

/**
 * Write-then-prune, for the same reason as replaceStoredSearchDocuments: deleting first and then
 * posting ~21k rows in one request meant any failure -- and a body that size failed reliably --
 * left the table empty rather than stale.
 */
export async function replaceStoredEntities(entityRows: EntityRow[], relationshipRows: EntityRelationshipRow[]) {
  if (entityRows.length === 0) {
    await deleteSupabaseRows("entity_relationships", "id=not.is.null");
    await deleteSupabaseRows("entities", "id=not.is.null");
    return;
  }

  await upsertSupabaseRowsInChunks("entities", entityRows, "id", ENTITY_CHUNK_SIZE);

  // Edges are pruned before the rows they name, so a stale relationship never outlives its entity.
  if (relationshipRows.length > 0) {
    await upsertSupabaseRowsInChunks("entity_relationships", relationshipRows, "id", ENTITY_CHUNK_SIZE);
    await deleteSupabaseRows("entity_relationships", `synced_at=lt.${oldestSyncedAt(relationshipRows)}`);
  } else {
    await deleteSupabaseRows("entity_relationships", "id=not.is.null");
  }

  await deleteSupabaseRows("entities", `synced_at=lt.${oldestSyncedAt(entityRows)}`);
}
