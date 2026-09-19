import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getStoredSearchDocumentByEntityId } from "@/lib/supabase/search";

export async function findEntityById(entityId: string) {
  if (!isSupabaseConfigured()) {
    return undefined;
  }

  return getStoredSearchDocumentByEntityId(entityId);
}
