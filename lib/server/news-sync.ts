import { randomUUID } from "node:crypto";

import { dedupeNewsArticles, fetchTopPoliticalArticles, isNewsApiConfigured } from "@/lib/adapters/newsapi";
import { listStoredBills } from "@/lib/supabase/bills";
import { listStoredIssues } from "@/lib/supabase/issues";
import { listStoredPoliticians } from "@/lib/supabase/politicians";
import { replaceStoredNews } from "@/lib/supabase/news";
import { dedupeByHeadline, summarizeArticleBody } from "@/lib/news-text";
import { slugifySegment } from "@/lib/utils";
import type { Bill, Issue, Politician } from "@/types/civic";
import type { NewsEntityLinkRow, NewsItemRow } from "@/types/supabase";

/** Always searched: coverage of Congress itself, whatever else is moving. */
export const CORE_NEWS_QUERIES = ["U.S. Congress", "U.S. Senate", "House of Representatives"];
const SPONSOR_QUERIES = 2;

/**
 * Keyword searches for one sync run -- five at most. Event Registry rate-limits the key, and the
 * old eight-query run was failing on 429 about half the time.
 *
 * The old queries were the first three bills, politicians and issues *as stored*, and politicians
 * are stored alphabetically: every run searched for Aaron Bean, Abraham Hamadeh and Adam Gray, so
 * the feed filled with Florida local news. Bill numbers ("S.5429") were no better as keywords. The
 * core queries keep the feed on Congress; the rest follow whoever sponsored the bills that moved
 * most recently, which rotates as Congress does. Bills arrive sorted by activity.
 */
export function buildNewsQueries(bills: Bill[], politicians: Politician[], _issues: Issue[] = []) {
  const nameById = new Map(politicians.map((politician) => [politician.id, politician.name]));
  const sponsors: string[] = [];
  for (const bill of bills) {
    const name = nameById.get(bill.sponsorId);
    if (name && !sponsors.includes(name)) sponsors.push(name);
    if (sponsors.length === SPONSOR_QUERIES) break;
  }
  return [...CORE_NEWS_QUERIES, ...sponsors];
}

export async function syncNewsFromApi() {
  if (!isNewsApiConfigured()) {
    throw new Error("News API is not configured");
  }

  const [bills, politicians, issues] = await Promise.all([
    listStoredBills(),
    listStoredPoliticians({ fresh: true }),
    listStoredIssues().catch(() => []),
  ]);

  const queries = buildNewsQueries(bills, politicians, issues);

  if (queries.length === 0) {
    return {
      synced: 0,
      at: new Date().toISOString(),
    };
  }

  // Newest first across all queries, so the 25-item cap keeps the most recent stories rather than
  // whichever query happened to come first.
  const articles = dedupeByHeadline(
    dedupeNewsArticles(
      (await Promise.all(queries.map((query) => fetchTopPoliticalArticles(query))))
        .flat(),
    ).sort((left, right) =>
      String(right.dateTime || right.date || "").localeCompare(String(left.dateTime || left.date || "")),
    ),
    (article) => article.title,
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
      source: article.source?.title || "NewsAPI.ai",
      published_at: article.dateTime || article.date || new Date().toISOString(),
      related_ids: relatedIds,
      summary: summarizeArticleBody(article.body) || "Stored political article.",
      url: article.url || null,
      source_system: "newsapi_ai",
      source_id: article.url || id,
      synced_at: new Date().toISOString(),
      // The full article body again; nothing reads it (rawAvailable is only ever a Boolean).
      raw_payload: null,
    };
  });

  const linkRows: NewsEntityLinkRow[] = newsRows.flatMap((row) =>
    row.related_ids.map((relatedId) => ({
      news_item_id: row.id,
      entity_id: relatedId,
      entity_type: "related",
      source_system: "newsapi_ai",
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
