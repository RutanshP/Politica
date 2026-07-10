import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";
import type { SearchEntity } from "@/types/civic";
import type { EntityRelationshipRow, EntityRow } from "@/types/supabase";

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
  const rows = await fetchSupabaseRows<EntityRow>("entities", "order=label.asc");
  return rows.map(mapRowToEntity);
}

export async function getStoredEntity(entityId: string) {
  const rows = await fetchSupabaseRows<EntityRow>(
    "entities",
    `id=eq.${encodeURIComponent(entityId)}&limit=1`,
  );
  const row = rows[0];
  return row ? mapRowToEntity(row) : undefined;
}

export async function replaceStoredEntities(entityRows: EntityRow[], relationshipRows: EntityRelationshipRow[]) {
  await deleteSupabaseRows("entity_relationships", "id=not.is.null");
  await deleteSupabaseRows("entities", "id=not.is.null");

  if (entityRows.length > 0) {
    await upsertSupabaseRows("entities", entityRows, "id");
  }
  if (relationshipRows.length > 0) {
    await upsertSupabaseRows("entity_relationships", relationshipRows, "id");
  }
}
