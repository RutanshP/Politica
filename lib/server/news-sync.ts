import { randomUUID } from "node:crypto";

import { dedupeNewsArticles, fetchTopPoliticalArticles, isNewsApiConfigured } from "@/lib/adapters/newsapi";
import { listStoredBills } from "@/lib/supabase/bills";
import { listStoredIssues } from "@/lib/supabase/issues";
import { listStoredPoliticians } from "@/lib/supabase/politicians";
import { replaceStoredNews } from "@/lib/supabase/news";
import { slugifySegment } from "@/lib/utils";
import type { NewsEntityLinkRow, NewsItemRow } from "@/types/supabase";

export async function syncNewsFromApi() {
  if (!isNewsApiConfigured()) {
    throw new Error("News API is not configured");
  }

  const [bills, politicians, issues] = await Promise.all([
    listStoredBills(),
    listStoredPoliticians(),
    listStoredIssues().catch(() => []),
  ]);

  const queries = [
    ...bills.slice(0, 5).map((bill) => bill.number),
    ...politicians.slice(0, 5).map((politician) => politician.name),
    ...issues.slice(0, 3).map((issue) => issue.name),
  ].filter(Boolean);

  const articles = dedupeNewsArticles(
    (await Promise.all(queries.map((query) => fetchTopPoliticalArticles(query))))
      .flat(),
  ).slice(0, 25);

  const newsRows: NewsItemRow[] = articles.map((article) => {
    const relatedIds = [
      ...bills.filter((bill) => article.title?.includes(bill.number || "")).map((bill) => bill.id),
      ...politicians.filter((politician) => article.title?.includes(politician.name)).map((politician) => politician.id),
      ...issues.filter((issue) => article.title?.includes(issue.name)).map((issue) => issue.id),
    ];
    const id = article.url ? slugifySegment(article.url) : randomUUID();

    return {
      id,
      canonical_id: article.url || article.title || null,
      headline: article.title || "Political coverage",
      source: article.source?.name || "News API",
      published_at: article.publishedAt || new Date().toISOString(),
      related_ids: relatedIds,
      summary: article.description || article.content || "Stored political article.",
      url: article.url || null,
      source_system: "newsapi",
      source_id: article.url || id,
      synced_at: new Date().toISOString(),
      raw_payload: article,
    };
  });

  const linkRows: NewsEntityLinkRow[] = newsRows.flatMap((row) =>
    row.related_ids.map((relatedId) => ({
      news_item_id: row.id,
      entity_id: relatedId,
      entity_type: "related",
      source_system: "newsapi",
      source_id: `${row.id}-${relatedId}`,
      synced_at: new Date().toISOString(),
      raw_payload: { relatedId },
    })),
  );

  await replaceStoredNews(newsRows, linkRows);

  return {
    synced: newsRows.length,
    at: new Date().toISOString(),
  };
}
