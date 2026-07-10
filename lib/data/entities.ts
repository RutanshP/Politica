import { emptyResult, withData } from "@/lib/data/result";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getStoredEntity, listStoredEntities } from "@/lib/supabase/entities";
import { getLatestSyncRun } from "@/lib/supabase/sync";

export async function getEntityIndex() {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "search_rebuild", [], "unconfigured"),
      entities: [],
    };
  }

  const [entities, latestRun] = await Promise.all([
    listStoredEntities(),
    getLatestSyncRun("search_rebuild").catch(() => undefined),
  ]);

  return {
    ...withData(
      entities.length > 0 ? "supabase" : "unavailable",
      "search_rebuild",
      entities,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: entities.length > 0 ? "live" : "empty",
        detail: latestRun?.status ? `Latest rebuild status: ${latestRun.status}` : "No entity rebuild history yet",
      },
    ),
    entities,
  };
}

export async function findEntityById(entityId: string) {
  if (!isSupabaseConfigured()) {
    return undefined;
  }

  return getStoredEntity(entityId);
}
