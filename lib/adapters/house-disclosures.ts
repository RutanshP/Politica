import "server-only";

import { inflateRawSync } from "node:zlib";

import {
  isElectronicHouseDoc,
  isTransactionReport,
  parseHouseIndex,
  parseHouseTransactions,
  type DisclosedTransaction,
  type HouseIndexRow,
} from "@/lib/stock-disclosures";

/**
 * House financial disclosures, from the Clerk's public disclosure site.
 *
 * The Clerk publishes one ZIP per year holding a tab-separated index of every filing, and serves the
 * documents themselves as individual PDFs. There is no API and no bulk transaction feed, so the
 * index is the only way to enumerate filings.
 */

const BASE = "https://disclosures-clerk.house.gov/public_disc";
const USER_AGENT = "Politica civic-data (contact: rutansh.pathak@gmail.com)";

/** Transaction reports live under ptr-pdfs; annual reports under financial-pdfs. */
export function houseTransactionReportUrl(year: number, docId: string) {
  return `${BASE}/ptr-pdfs/${year}/${docId}.pdf`;
}

/**
 * Reads the entries of a ZIP without a dependency.
 *
 * The archive holds two small files and uses only stored/deflate, so walking local file headers and
 * inflating is enough. Pulling in a zip library for this would be the larger cost.
 */
function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();

  for (let offset = 0; offset < buffer.length - 4; offset += 1) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) continue;

    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;

    // A zero compressed size means the sizes live in a trailing data descriptor, which this reader
    // does not handle. Skipping is correct: the entries we want never use it.
    if (!compressedSize) continue;

    const payload = buffer.subarray(start, start + compressedSize);
    try {
      entries.set(name, method === 0 ? Buffer.from(payload) : inflateRawSync(payload));
    } catch {
      // A corrupt entry should not lose the rest of the archive.
    }

    offset = start + compressedSize - 1;
  }

  return entries;
}

/** The filing index for one year. */
export async function fetchHouseFilingIndex(year: number): Promise<HouseIndexRow[]> {
  const response = await fetch(`${BASE}/financial-pdfs/${year}FD.zip`, {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`House index ${year} failed: ${response.status}`);

  const entries = readZipEntries(Buffer.from(await response.arrayBuffer()));
  const textEntry = [...entries.entries()].find(([name]) => name.toLowerCase().endsWith(".txt"));

  if (!textEntry) throw new Error(`House index ${year} contained no .txt entry`);

  return parseHouseIndex(textEntry[1].toString("utf8"));
}

/** Transaction reports only -- the other filing types carry holdings or candidacy, not trades. */
export function transactionReportRows(rows: HouseIndexRow[]) {
  return rows.filter((row) => isTransactionReport(row.filingType));
}

export type HouseExtraction =
  | { status: "parsed"; transactions: DisclosedTransaction[] }
  | { status: "scanned" }
  | { status: "no_text" }
  | { status: "fetch_failed"; detail: string }
  | { status: "extract_failed"; detail: string };

/**
 * Transactions from one House filing, with the reason attached whenever there are none.
 *
 * The status is the point of this signature. Roughly 28% of filings are scans of paper with no text
 * layer, and an extraction that quietly returns an empty array puts those members in the record as
 * having disclosed nothing. Every non-parsed outcome is named so it can be stored and counted --
 * `scanned` is a property of the document, `extract_failed` is a bug worth chasing, and collapsing
 * them into one empty result hides the difference.
 */
export async function fetchHouseTransactions(year: number, docId: string): Promise<HouseExtraction> {
  // Cheap and certain: the DocID says whether a text layer exists, so a scan costs no download.
  if (!isElectronicHouseDoc(docId)) return { status: "scanned" };

  const url = houseTransactionReportUrl(year, docId);

  let data: Uint8Array;
  try {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
    if (!response.ok) return { status: "fetch_failed", detail: `HTTP ${response.status}` };
    data = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    return { status: "fetch_failed", detail: error instanceof Error ? error.message : String(error) };
  }

  try {
    const text = await extractPdfLines(data);
    if (!text.trim()) return { status: "no_text" };

    const transactions = parseHouseTransactions(text);
    // Text but no rows is a real possibility -- an amended filing can report no transactions -- so
    // it is `parsed` with a count of zero rather than a failure.
    return { status: "parsed", transactions };
  } catch (error) {
    return { status: "extract_failed", detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Rebuilds the page's lines from pdf.js's positioned runs.
 *
 * These PDFs embed subsetted fonts, so the raw content streams hold glyph indices rather than
 * characters. The transaction table has no structure to read either -- its columns are implied by x
 * position -- so lines have to be reassembled by y before the parser can anchor on them.
 */
async function extractPdfLines(data: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
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
        .map(([, runs]) =>
          runs
            .sort((l, r) => l.x - r.x)
            .map((run) => run.s)
            .join(" ")
            // These forms set their labels in small caps, and the subsetted font maps every
            // lowercase glyph to NUL rather than to a character. Left in, "Filing Status:" reads as
            // "F\0\0\0\0\0 S\0\0\0\0\0:" -- which no \s pattern matches, so the label went
            // unrecognised and its line was absorbed into the transaction above it, dragging the
            // description's per-share prices into the disclosed amount.
            .replace(/\u0000+/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter(Boolean)
        .join("\n"),
    );
  }

  // destroy() lives on the loading task; the document proxy does not expose it.
  await loadingTask.destroy();
  return pages.join("\n");
}
