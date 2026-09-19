/*
 * Pure text helpers for news items, shared by the sync (which cleans what it stores) and the read
 * path (which cleans what was stored before the sync did).
 */

const normalizeHeadline = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Drops syndicated copies: one wire story ran as four rows (Yahoo News, Yahoo News UK and two
 * Independent domains), each with its own URL, so deduping on URL alone kept them all.
 */
export function dedupeByHeadline<T>(items: T[], headlineOf: (item: T) => string | null | undefined) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const headline = headlineOf(item);
    const key = headline ? normalizeHeadline(headline) : "";
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const SUMMARY_TARGET = 280;
const SUMMARY_MAX = 420;
// Syndication boilerplate that leads the body on aggregator copies.
const BOILERPLATE = /^(add yahoo as a preferred source[^.]*\.\s*)/i;

/**
 * The first few sentences of an article, not the article. `summary` used to hold the full body --
 * up to 18KB per row -- which the news page then printed in full on every card.
 */
export function summarizeArticleBody(body: string | null | undefined) {
  const text = (body ?? "").replace(BOILERPLATE, "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= SUMMARY_MAX) return text;

  let summary = "";
  for (const sentence of text.match(/[^.!?]+[.!?]+["')\]]?\s*/g) ?? []) {
    if (summary.length + sentence.length > SUMMARY_MAX) break;
    summary += sentence;
    if (summary.length >= SUMMARY_TARGET) break;
  }
  return summary.trim() || `${text.slice(0, SUMMARY_TARGET).replace(/\s+\S*$/, "")}…`;
}
