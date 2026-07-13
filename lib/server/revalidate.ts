import { revalidateTag } from "next/cache";

import { ALL_CACHE_TAGS } from "@/lib/supabase/cache-tags";

/**
 * Invalidates the Supabase read caches after a sync writes.
 *
 * Read paths are cached (see lib/supabase/rest.ts) rather than using `no-store`, so this is
 * what makes freshly synced data visible. revalidatePath() alone is not sufficient: a single
 * cached read (e.g. the bills list) is shared by several routes, and tags invalidate the
 * underlying Data Cache entry wherever it is used.
 */
export function revalidatePoliticaCaches(tags: string[] = ALL_CACHE_TAGS) {
  for (const tag of tags) {
    // `{ expire: 0 }` is the documented form for route handlers driven by an external caller
    // (here, the sync cron) that need the tagged data to expire immediately rather than be
    // served stale-while-revalidate. The single-argument form is deprecated in Next 16.
    revalidateTag(tag, { expire: 0 });
  }
}
