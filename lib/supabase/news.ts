import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";
import { formatDateLabel, formatInlineText } from "@/lib/utils";
import type { NewsItem } from "@/types/civic";
import type { NewsEntityLinkRow, NewsItemRow } from "@/types/supabase";

function mapRowToNewsItem(row: NewsItemRow): NewsItem {
  return {
    id: row.id,
    canonicalId: row.canonical_id || undefined,
    headline: formatInlineText(row.headline),
    source: row.source,
    // Stored as a raw ISO timestamp; every consumer renders it directly.
    publishedAt: formatDateLabel(row.published_at),
    relatedIds: row.related_ids,
    summary: formatInlineText(row.summary),
    url: row.url || undefined,
    sourceMetadata: {
      sourceSystem: row.source_system,
      sourceId: row.source_id,
      syncedAt: row.synced_at,
      rawAvailable: Boolean(row.raw_payload),
    },
  };
}

export async function listStoredNewsItems() {
  const rows = await fetchSupabaseRows<NewsItemRow>("news_items", "order=published_at.desc");
  return rows.map(mapRowToNewsItem);
}

export async function replaceStoredNews(newsRows: NewsItemRow[], linkRows: NewsEntityLinkRow[]) {
  await deleteSupabaseRows("news_entity_links", "news_item_id=not.is.null");
  await deleteSupabaseRows("news_items", "id=not.is.null");

  const items = newsRows.length > 0 ? await upsertSupabaseRows("news_items", newsRows, "id") : [];
  if (linkRows.length > 0) {
    await upsertSupabaseRows("news_entity_links", linkRows, "news_item_id,entity_id");
  }

  return items;
}
