import { emptyResult, withData } from "@/lib/data/result";
import { listStoredNewsItems } from "@/lib/supabase/news";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getLatestSyncRun } from "@/lib/supabase/sync";
import type { NewsItem } from "@/types/civic";

export type NewsDataSource = "supabase" | "unconfigured" | "unavailable";

export async function getNewsData() {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "news_sync", [] as NewsItem[], "unconfigured"),
      news: [] as NewsItem[],
    };
  }

  try {
    const [news, latestRun] = await Promise.all([
      listStoredNewsItems(),
      getLatestSyncRun("news_sync").catch(() => undefined),
    ]);
    const result = withData(
      news.length > 0 ? "supabase" : "unavailable",
      "news_sync",
      news,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: news.length > 0 ? "live" : "empty",
        detail: latestRun?.status ? `Latest sync status: ${latestRun.status}` : "No news sync history yet",
      },
    );
    return {
      ...result,
      source: result.source as NewsDataSource,
      news,
    };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "news_sync", [] as NewsItem[], "unavailable", error instanceof Error ? error.message : "Stored news read failed"),
      news: [] as NewsItem[],
    };
  }
}
