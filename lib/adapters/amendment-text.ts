import "server-only";

/**
 * Amendment text, from the House Rules Committee.
 *
 * Congress publishes no House amendment text in any machine-readable feed -- /amendment/{congress}/
 * hamdt/{n}/text returns an empty textVersions array, and the House Report that supposedly prints
 * them carries only a one-line summary per amendment. The Rules Committee is the actual source: it
 * posts every submitted amendment as its own PDF, linked from the bill's Rules page.
 */

/** A row scraped from rules.house.gov: one submitted amendment and its document. */
export interface RulesAmendmentRow {
  /** Sponsor as printed, e.g. "Grothman (WI)". */
  sponsor: string;
  /** The summary line, which is what matches this row to a stored amendment. */
  summary: string;
  pdfUrl: string;
}

const RULES_BILL_URL = "https://rules.house.gov/bill";

function stripTags(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalized comparison key for a summary line.
 *
 * The Rules row and the congress.gov description state the same amendment in the same words, but
 * congress.gov prefixes its own bookkeeping ("An amendment numbered 316 printed in Part A of House
 * Report 119-755 to require...") and the two differ in case and punctuation. Stripping the prefix
 * and reducing to words makes them comparable without a fuzzy-match library.
 */
export function amendmentSummaryKey(text: string) {
  return (text || "")
    // "An amendment numbered 316 printed in Part A of House Report 119-755 to require ..." ->
    // "require ...". The lazy run stops at the first " to ", which is the one separating the
    // citation from the substance.
    .replace(/^an amendment numbered\s+\S+\s+printed in\s+.*?\s+to\s+/i, "")
    // Same prefix without a trailing "to" clause.
    .replace(/^an amendment numbered\s+\S+\s+printed in\s+[^,.]*[,.]?\s*/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** How much of the shorter summary must appear in the longer for the rows to be the same amendment. */
const MATCH_THRESHOLD = 0.6;

/** Word overlap, which is enough here because both sides are the same sentence from the same clerk. */
export function summarySimilarity(left: string, right: string) {
  const a = new Set(amendmentSummaryKey(left).split(" ").filter((w) => w.length > 3));
  const b = new Set(amendmentSummaryKey(right).split(" ").filter((w) => w.length > 3));
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/**
 * Amendment rows for a bill, scraped from its Rules Committee page.
 *
 * Parsed from the raw HTML rather than a table library: the page is a 900KB Drupal render whose
 * amendment table has no stable class names, but each row reliably pairs an amendments-rules.house.gov
 * PDF link with the sponsor and summary that follow it.
 */
export async function fetchRulesAmendments(input: {
  congress: string;
  billType: string;
  billNumber: string;
}): Promise<RulesAmendmentRow[]> {
  const url = `${RULES_BILL_URL}/${input.congress}/${input.billType.toLowerCase()}-${input.billNumber}`;
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "text/html" } });
  if (!response.ok) return [];

  const html = await response.text();
  const rows: RulesAmendmentRow[] = [];

  // Each amendment's PDF anchor, then the row text that follows it up to the next anchor.
  const anchor = /href="(https:\/\/amendments-rules\.house\.gov\/amendments\/[^"]+\.pdf)"/gi;
  const matches = [...html.matchAll(anchor)];

  matches.forEach((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? html.length : html.length;
    const rowText = stripTags(html.slice(start, Math.min(end, start + 6000)));

    // "... Version 1 Grothman (WI) Republican Late <summary> Made in Order ..."
    const sponsor = /([A-Z][A-Za-z'\-. ]{1,40}\([A-Z]{2}\))/.exec(rowText)?.[1]?.trim() ?? "";
    const summary = /(?:Republican|Democrat)\s+(?:Late\s+)?(.{40,600}?)(?:\s+(?:Made in Order|Submitted|Withdrawn|Revised|Considered)\b|$)/
      .exec(rowText)?.[1]?.trim() ?? "";

    if (sponsor && summary) {
      rows.push({ sponsor, summary, pdfUrl: match[1] });
    }
  });

  return rows;
}

/**
 * Strips the drafting artifacts these PDFs carry into their text layer.
 *
 * They are generated from the House XML drafting system, which prints the author's own working
 * path as the first line -- "G:\M\19\HARRIG\HARRIG_085.XML" -- and stamps a page footer on each
 * page. Neither is part of the amendment, and both land in the middle of the extracted text where
 * pages join.
 */
export function cleanAmendmentText(raw: string) {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // Drafting path, e.g. G:\M\19\SELF\SELF_193.XML
    .filter((line) => !/^[A-Z]:\\[\\A-Z0-9_.\-]+\.XML$/i.test(line))
    // "(Original Signature of Member)" and bare page numbers between pages.
    .filter((line) => !/^\(?original signature of member\)?$/i.test(line))
    .filter((line) => !/^\d{1,3}$/.test(line))
    /*
     * These are printed with line numbers down the margin, and the number sits on the same
     * baseline as the text, so rebuilding the row glues them together: "1SEC. 28ll. PROHIBITION".
     * Only stripped where a capital or section marker follows, so a real figure at the start of a
     * line ("200,000 employees") survives.
     */
    .map((line) => line.replace(/^\d{1,2}(?=[A-Z(§])/, ""));

  /*
   * Rejoin words the PDF hyphenated across lines -- "add the fol-" / "lowing new section". Only
   * where the next line starts lowercase, so a genuine compound broken at a line end
   * ("cost-" / "Effective") is left alone.
   */
  const joined: string[] = [];
  for (const line of lines) {
    const previous = joined[joined.length - 1];
    if (previous?.endsWith("-") && /^[a-z]/.test(line)) {
      joined[joined.length - 1] = previous.slice(0, -1) + line;
      continue;
    }
    joined.push(line);
  }

  return joined.join("\n").trim();
}

/**
 * Text of one amendment PDF.
 *
 * pdf.js rather than a regex over the file: these PDFs embed subsetted fonts, so the raw content
 * streams hold glyph indices and naive extraction returns noise. Lines are rebuilt from the
 * positioned runs because legislative text is line-oriented -- "At the end of subtitle A of title
 * XI, insert the following new section:" only means something as a line.
 */
export async function fetchAmendmentPdfText(pdfUrl: string): Promise<string | null> {
  // Filenames are the sponsor's own upload, so they carry spaces and brackets that must be encoded
  // before they reach fetch -- "NDAA Amendment - Civilian Employee Reduction Report...pdf".
  const response = await fetch(encodeURI(pdfUrl), { cache: "no-store" });
  if (!response.ok) return null;

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await response.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true });
  const doc = await loadingTask.promise;

  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();

    const rows = new Map<number, Array<{ x: number; s: string }>>();
    for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
      if (!item.str || !item.transform) continue;
      const y = Math.round(item.transform[5]);
      rows.set(y, [...(rows.get(y) ?? []), { x: item.transform[4], s: item.str }]);
    }

    pages.push(
      [...rows.entries()]
        .sort((left, right) => right[0] - left[0])
        .map(([, runs]) => runs.sort((l, r) => l.x - r.x).map((run) => run.s).join("").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n"),
    );
  }

  // destroy() lives on the loading task; the document proxy does not expose it.
  await loadingTask.destroy();
  const text = cleanAmendmentText(pages.join("\n"));
  return text.length > 0 ? text : null;
}

/** The Rules row whose summary matches this amendment, or undefined when nothing is close enough. */
export function matchRulesRow(rows: RulesAmendmentRow[], amendment: { sponsor?: string | null; summary?: string | null }) {
  const surname = (amendment.sponsor || "").replace(/\s*\([^)]*\)\s*/g, "").trim().toLowerCase();

  const scored = rows
    .map((row) => ({
      row,
      // Sponsor agreement is a strong prior but not sufficient: a member can offer several.
      sponsorMatch: surname.length > 2 && row.sponsor.toLowerCase().includes(surname),
      score: summarySimilarity(row.summary, amendment.summary || ""),
    }))
    .filter((candidate) => candidate.score >= MATCH_THRESHOLD || (candidate.sponsorMatch && candidate.score >= 0.4))
    .sort((left, right) => Number(right.sponsorMatch) - Number(left.sponsorMatch) || right.score - left.score);

  return scored[0]?.row;
}
