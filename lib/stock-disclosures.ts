/**
 * Parsing for congressional stock disclosures.
 *
 * Pure string-in/data-out so every format quirk below is testable without the network. The two
 * chambers publish the same legal filing in completely different shapes: the Senate renders an HTML
 * table with one cell per field, while the House prints a PDF whose rows wrap across lines and whose
 * columns are only implied by position. Everything chamber-specific is confined to this file.
 */

/** A single disclosed transaction, in the shape both chambers normalize to. */
export interface DisclosedTransaction {
  owner: OwnerCode;
  ticker: string | null;
  assetName: string;
  assetType: string | null;
  transactionType: TransactionType;
  transactionDate: string | null;
  filedOn: string | null;
  amountMin: number | null;
  amountMax: number | null;
  comment: string | null;
}

export type OwnerCode = "self" | "spouse" | "child" | "joint";
export type TransactionType = "purchase" | "sale" | "sale_full" | "sale_partial" | "exchange" | "other";

/**
 * Owner of the asset.
 *
 * Filings cover a spouse and dependent children as well as the member. This is carried all the way
 * to the UI rather than flattened: presenting a spouse's trade as the member's own would be a
 * misattribution, and it is the single most common way this data gets misreported.
 */
export function normalizeOwner(raw: string | null | undefined): OwnerCode {
  const value = (raw || "").trim().toLowerCase();
  if (!value || value === "--") return "self";
  if (value.startsWith("sp") || value.includes("spouse")) return "spouse";
  if (value.startsWith("dc") || value.includes("child") || value.includes("dependent")) return "child";
  if (value.startsWith("jt") || value.includes("joint")) return "joint";
  return "self";
}

/**
 * Transaction type.
 *
 * The House prints single letters (P/S/E, plus "S (partial)"); the Senate spells them out
 * ("Sale (Full)", "Purchase", "Exchange"). Full and partial sales stay distinct because a partial
 * sale leaves a position open, so treating it as an exit would misstate what happened.
 */
export function normalizeTransactionType(raw: string | null | undefined): TransactionType {
  const value = (raw || "").trim().toLowerCase();
  if (!value) return "other";

  if (value === "p" || value.startsWith("purchase")) return "purchase";
  if (value === "e" || value.startsWith("exchange")) return "exchange";

  if (value === "s" || value.startsWith("sale") || value.startsWith("sold")) {
    if (value.includes("partial")) return "sale_partial";
    if (value.includes("full")) return "sale_full";
    return "sale";
  }

  // "S (partial)" arrives with the letter and the qualifier split by punctuation.
  if (/^s\b/.test(value)) return value.includes("partial") ? "sale_partial" : "sale";

  return "other";
}

/** True for any of the three sale variants, which several callers need to branch on. */
export function isSale(type: TransactionType) {
  return type === "sale" || type === "sale_full" || type === "sale_partial";
}

/**
 * The disclosed dollar band, as both bounds.
 *
 * Never reduced to a midpoint. The lowest band spans $1,001-$15,000 and the highest is open-ended
 * above $50,000,000, so a midpoint is not an estimate of the amount -- it is a number the filing
 * does not contain, and it reads to a viewer as a measurement.
 *
 * Returns nulls rather than zeros for unparseable input so "no amount disclosed" stays
 * distinguishable from "$0".
 */
export function parseAmountBand(raw: string | null | undefined): { min: number | null; max: number | null } {
  const text = (raw || "").replace(/–|—/g, "-").trim();
  if (!text || text === "--") return { min: null, max: null };

  const numbers = [...text.matchAll(/\$\s*([\d,]+)/g)].map((match) => Number(match[1].replace(/,/g, "")));
  const usable = numbers.filter((value) => Number.isFinite(value));

  if (usable.length === 0) return { min: null, max: null };

  // "Over $50,000,000" / "$50,000,000 +" has no upper bound, and inventing one would understate
  // exactly the trades that matter most.
  if (usable.length === 1) {
    if (/over|\+|more than|at least/i.test(text)) return { min: usable[0], max: null };
    return { min: usable[0], max: usable[0] };
  }

  return { min: Math.min(...usable), max: Math.max(...usable) };
}

/** MM/DD/YYYY (both chambers) to an ISO date, or null when the field is blank or malformed. */
export function parseDisclosureDate(raw: string | null | undefined): string | null {
  const match = (raw || "").trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += year < 50 ? 2000 : 1900;

  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * A tradable ticker, or null.
 *
 * Filings put several different things in parentheses. A CUSIP ("91282CJP7") identifies a Treasury
 * note and is nine alphanumerics; a ticker is one to five letters. Returning a CUSIP as a ticker
 * would send it to the price API, which answers with nothing, and the trade would then look like a
 * lookup failure rather than what it is -- a bond, which has no market price to compare.
 */
export function normalizeTicker(raw: string | null | undefined): string | null {
  const value = (raw || "").trim().toUpperCase().replace(/^\(|\)$/g, "");
  if (!value || value === "--" || value === "N/A" || value === "NONE") return null;

  // CUSIP: nine characters mixing digits and letters.
  if (value.length === 9 && /\d/.test(value) && /[A-Z]/.test(value)) return null;

  if (!/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(value)) return null;

  return value;
}

// ---------------------------------------------------------------------------
// House
// ---------------------------------------------------------------------------

/** One row of the House Clerk's yearly filing index. */
export interface HouseIndexRow {
  last: string;
  first: string;
  prefix: string;
  suffix: string;
  filingType: string;
  stateDst: string;
  year: number;
  filingDate: string | null;
  docId: string;
}

/**
 * Whether a House DocID points at an electronically filed document with a text layer.
 *
 * Verified across four years without a miss: IDs beginning "2" are e-filed transaction reports and
 * carry extractable text; those beginning "8" or "9" are scans of paper and carry none. Knowing this
 * before fetching is what lets a scan be recorded as `scanned` rather than discovered later as an
 * empty extraction, which is indistinguishable from a member who did not trade.
 */
export function isElectronicHouseDoc(docId: string | null | undefined) {
  return /^2/.test((docId || "").trim());
}

/** Rows of the tab-separated index inside {year}FD.zip. */
export function parseHouseIndex(tsv: string): HouseIndexRow[] {
  const lines = (tsv || "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) return [];

  const rows: HouseIndexRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    if (cells.length < 9) continue;

    const docId = (cells[8] || "").trim();
    if (!docId) continue;

    rows.push({
      prefix: (cells[0] || "").trim(),
      last: (cells[1] || "").trim(),
      first: (cells[2] || "").trim(),
      suffix: (cells[3] || "").trim(),
      filingType: (cells[4] || "").trim(),
      stateDst: (cells[5] || "").trim(),
      year: Number((cells[6] || "").trim()) || 0,
      filingDate: parseDisclosureDate(cells[7]),
      docId,
    });
  }

  return rows;
}

/** Filing type "P" is the periodic transaction report -- the only type carrying individual trades. */
export function isTransactionReport(filingType: string | null | undefined) {
  return (filingType || "").trim().toUpperCase() === "P";
}

/**
 * The anchor line of a House transaction.
 *
 * Each transaction begins on the line carrying the type letter and both dates; the asset name, its
 * ticker, its bracketed type code and the band's upper bound spill onto the lines below. Matching on
 * this signature rather than on line order is what makes the wrapping irrelevant.
 *
 * Amended filings prefix each row with the original transaction's id, which sits *before* the owner
 * code. Without allowing for it the owner group cannot match, and every spouse-owned trade on an
 * amended report is recorded as the member's own -- the one attribution error that matters most
 * here.
 */
const HOUSE_ANCHOR = /^(?:\d{8,}\s+)?(?:(SP|DC|JT)\s+)?(.*?)\s+(S \(partial\)|[PSE])\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\$[\d,]+.*)$/;

/**
 * Lines that end a transaction block.
 *
 * The per-transaction labels ("Filing Status:", "Subholding Of:", "Description:") are set in small
 * caps, and the extractor reduces their lowercase glyphs to nothing -- so they arrive as a short run
 * of capitals followed by a colon. Matching that shape rather than each specific label keeps a
 * label this parser has not seen from being swallowed into the row above it.
 *
 * The description line is the one that matters most: it quotes per-share prices ("@ $27.645/share"),
 * and absorbing it replaced the disclosed band's lower bound with a share price.
 */
const HOUSE_LABEL_LINE = /^[A-Z](\s+[A-Z])*\s*:/;

/** The column header, which repeats on every page and would otherwise read as continuation. */
const HOUSE_TABLE_HEADER = /^(ID\s+Owner\s+Asset|Type\s+Date|\$\d+\?|\*\s|I\s+P\s+O)/;

function isHouseBlockEnd(line: string) {
  return HOUSE_LABEL_LINE.test(line) || HOUSE_TABLE_HEADER.test(line);
}

/**
 * Transactions from the extracted text of a House transaction report.
 *
 * The PDF has no table structure to read -- pdf.js returns positioned runs, and the rebuilt lines
 * are all that survives. So the parse is anchored on the one signature that is unambiguous (type
 * letter followed by two dates followed by a dollar figure) and everything between anchors is
 * treated as continuation of the row above.
 */
export function parseHouseTransactions(text: string): DisclosedTransaction[] {
  const lines = (text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const transactions: DisclosedTransaction[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(HOUSE_ANCHOR);
    if (!match) continue;

    const [, ownerRaw, assetHead, typeRaw, dateRaw, filedRaw, amountHead] = match;

    // Absorb continuation lines: the asset name's tail, "[ST]", and the band's upper bound. Capped
    // at three, because every real wrap is one or two lines and an uncapped run would let a missed
    // block-end consume the rest of the page.
    const continuation: string[] = [];
    for (let next = index + 1; next < lines.length && continuation.length < 3; next += 1) {
      if (isHouseBlockEnd(lines[next]) || HOUSE_ANCHOR.test(lines[next])) break;
      continuation.push(lines[next]);
    }

    const tail = continuation.join(" ");
    // The upper bound routinely wraps -- "$15,001 -" ends the anchor line and "$50,000" opens the
    // next -- so the continuation has to be consulted. But only when the anchor is actually
    // incomplete: reaching into it unconditionally is what let a description line's per-share price
    // become a trade's lower bound.
    const headBand = parseAmountBand(amountHead);
    const band = headBand.min !== null && headBand.max !== null && headBand.min !== headBand.max
      ? headBand
      : parseAmountBand(`${amountHead} ${tail}`);

    transactions.push({
      owner: normalizeOwner(ownerRaw),
      ticker: extractHouseTicker(`${assetHead} ${tail}`),
      assetName: cleanHouseAssetName(`${assetHead} ${tail}`),
      assetType: extractBracketCode(`${assetHead} ${tail}`),
      transactionType: normalizeTransactionType(typeRaw),
      transactionDate: parseDisclosureDate(dateRaw),
      filedOn: parseDisclosureDate(filedRaw),
      amountMin: band.min,
      amountMax: band.max,
      comment: null,
    });
  }

  return transactions;
}

/** The bracketed asset-type code, e.g. "[ST]" for stock or "[GS]" for a government security. */
function extractBracketCode(text: string) {
  const match = text.match(/\[([A-Z]{2,3})\]/);
  return match ? match[1] : null;
}

/**
 * The ticker from a House asset string.
 *
 * Takes the last parenthesised group that survives normalizeTicker: an asset can carry both a
 * company name in parentheses and a symbol, and the symbol is the trailing one.
 *
 * Falls back to the "DIA - State Street SPDR Dow Jones" form, where filers put the symbol first and
 * the name after a dash. Anchored to the start and bounded to five capitals so it cannot fire on an
 * ordinary asset name -- "US Treasury Bill 912797PD3" has no dash in that position, and "AT&T Inc."
 * is not all letters.
 */
function extractHouseTicker(text: string) {
  const groups = [...text.matchAll(/\(([^()]{1,12})\)/g)].map((match) => match[1]);
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const ticker = normalizeTicker(groups[index]);
    if (ticker) return ticker;
  }

  const leading = text.trim().match(/^([A-Z]{1,5})\s+[-–]\s+/);
  return leading ? normalizeTicker(leading[1]) : null;
}

/** Asset name with the ticker, type code and any stray band text removed. */
function cleanHouseAssetName(text: string) {
  return text
    .replace(/\[[A-Z]{2,3}\]/g, " ")
    .replace(/\$[\d,]+\s*-?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Senate
// ---------------------------------------------------------------------------

/**
 * Transactions from a Senate electronic report page.
 *
 * The Senate renders these as a real HTML table -- one cell per field, ticker and amount already
 * separated -- so this needs no positional guessing at all. Paper filings render as an embedded PDF
 * image with no table, and yield nothing here; the caller records those as `scanned`.
 */
export function parseSenateTransactions(html: string): DisclosedTransaction[] {
  const table = (html || "").match(/<table[\s\S]*?<\/table>/i);
  if (!table) return [];

  const transactions: DisclosedTransaction[] = [];

  for (const rowHtml of table[0].match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = (rowHtml.match(/<td[\s\S]*?<\/td>/gi) || []).map(stripHtmlCell);
    // #, date, owner, ticker, asset, asset type, type, amount, comment
    if (cells.length < 8) continue;
    if (!/^\d+$/.test(cells[0])) continue;

    const assetName = cells[4];
    if (!assetName) continue;

    const band = parseAmountBand(cells[7]);

    transactions.push({
      owner: normalizeOwner(cells[2]),
      ticker: normalizeTicker(cells[3]),
      assetName,
      assetType: cells[5] || null,
      transactionType: normalizeTransactionType(cells[6]),
      transactionDate: parseDisclosureDate(cells[1]),
      filedOn: null,
      amountMin: band.min,
      amountMax: band.max,
      comment: cells[8] && cells[8] !== "--" ? cells[8] : null,
    });
  }

  return transactions;
}

function stripHtmlCell(cell: string) {
  return cell
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A Senate search row links either an electronic report or a scan; only the former can be parsed. */
export function isSenateElectronicReport(link: string | null | undefined) {
  return /\/search\/view\/(ptr|annual)\//.test(link || "");
}
