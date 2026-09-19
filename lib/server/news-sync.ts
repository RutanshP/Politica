import { randomUUID } from "node:crypto";

import { dedupeNewsArticles, fetchTopPoliticalArticles, isNewsApiConfigured } from "@/lib/adapters/newsapi";
import { listStoredBillStatusRows, type BillStatusRow } from "@/lib/supabase/bills";
import { listStoredIssues } from "@/lib/supabase/issues";
import { listStoredPoliticians } from "@/lib/supabase/politicians";
import { replaceStoredNews } from "@/lib/supabase/news";
import { dedupeByHeadline, summarizeArticleBody } from "@/lib/news-text";
import { slugifySegment } from "@/lib/utils";
import type { Politician } from "@/types/civic";
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
export function buildNewsQueries(
  bills: Array<Pick<BillStatusRow, "sponsor_id">>,
  politicians: Array<Pick<Politician, "id" | "name">>,
) {
  const nameById = new Map(politicians.map((politician) => [politician.id, politician.name]));
  const sponsors: string[] = [];
  for (const bill of bills) {
    const name = nameById.get(bill.sponsor_id);
    if (name && !sponsors.includes(name)) sponsors.push(name);
    if (sponsors.length === SPONSOR_QUERIES) break;
  }
  return [...CORE_NEWS_QUERIES, ...sponsors];
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whole-term match. `title.includes(bill.number || "")` linked every bill with a blank number --
 * every string contains "" -- and let "HR.1" match inside "HR.1234".
 */
export function mentions(text: string, term: string | null | undefined) {
  if (!term?.trim()) return false;
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(term.trim())}($|[^A-Za-z0-9])`, "i").test(text);
}

const CONGRESS_TERMS = /\b(Congress(?:ional|man|woman)?|Senate|Senators?|House (?:Republicans|Democrats|GOP|Speaker|floor|vote|passes|passed|committee)|Speaker (?:of the House|Johnson)|lawmakers?|Capitol Hill|filibuster|appropriations|shutdown|legislation)\b|\b(?:Rep|Sen)\.\s/i;
const NOT_NEWS = /promo code|bonus code|best crypto|crypto to buy|betting odds|sportsbook|horoscope|UPSC/i;

/**
 * Whether an article is about the US Congress: its headline or lede names Congress or its work, or
 * it names a tracked member or bill. The keyword queries alone let through anything that matched a
 * common word -- a Senate anywhere, a "house" in a real-estate story.
 */
export function isAboutCongress(
  article: { title?: string | null; body?: string | null },
  trackedTerms: Array<string | null | undefined> = [],
) {
  const title = article.title ?? "";
  if (!title || NOT_NEWS.test(title)) return false;
  if (trackedTerms.some((term) => mentions(title, term))) return true;
  const lede = `${title} ${(article.body ?? "").slice(0, 600)}`;
  return CONGRESS_TERMS.test(lede);
}

export async function syncNewsFromApi() {
  if (!isNewsApiConfigured()) {
    throw new Error("News API is not configured");
  }

  // Status rows, not listStoredBills(): this needs a bill's number and sponsor, not its summary,
  // and the full read was ~18 seconds of the run. They arrive most recently active first.
  const [bills, politicians, issues] = await Promise.all([
    listStoredBillStatusRows(),
    listStoredPoliticians({ fresh: true }),
    listStoredIssues().catch(() => []),
  ]);

  const queries = buildNewsQueries(bills, politicians);
  // Members only by full name: a bare surname ("Scott", "Young") matches far too much.
  const trackedNames = politicians.map((politician) => politician.name);

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
        .flat()
        .filter((article) => isAboutCongress(article, trackedNames)),
    ).sort((left, right) =>
      String(right.dateTime || right.date || "").localeCompare(String(left.dateTime || left.date || "")),
    ),
    (article) => article.title,
  ).slice(0, 25);

  const newsRows: NewsItemRow[] = articles.map((article) => {
    const title = article.title || "";
    const relatedIds = [
      ...bills.filter((bill) => mentions(title, bill.number)).map((bill) => bill.id),
      ...politicians.filter((politician) => mentions(title, politician.name)).map((politician) => politician.id),
      ...issues.filter((issue) => mentions(title, issue.name)).map((issue) => issue.id),
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
