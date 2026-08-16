import {
  fetchHouseFilingIndex,
  fetchHouseTransactions,
  houseTransactionReportUrl,
  transactionReportRows,
} from "@/lib/adapters/house-disclosures";
import {
  fetchAllSenateFilings,
  fetchSenateReportTransactions,
  openSenateSession,
  type SenateFilingRow,
} from "@/lib/adapters/senate-efd";
import { buildFilerIndex, matchFiler, type MatchableMember } from "@/lib/stock-filer-match";
import type { DisclosedTransaction, HouseIndexRow } from "@/lib/stock-disclosures";
import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";

/**
 * Loads congressional stock disclosures into `stock_filings` and `stock_transactions`.
 *
 * Every filing is written whether or not anything could be read from it. Roughly 28% are scans of
 * paper with no text layer, and a pipeline that stores only its successes leaves those members
 * looking like they disclosed nothing -- which is a factual claim the data does not support. The
 * filing row carries the reason instead, so "no trades" and "we could not read this" stay
 * distinguishable in the UI and countable in the sync result.
 */

export interface StockSyncResult {
  chamber: "house" | "senate" | "both";
  filingsSeen: number;
  filingsWritten: number;
  transactionsWritten: number;
  byStatus: Record<string, number>;
  unmatchedFilers: string[];
  errors: string[];
}

interface FilingRow {
  id: string;
  chamber: "house" | "senate";
  doc_id: string;
  politician_id: string | null;
  filer_name: string;
  filer_state: string | null;
  filing_year: number | null;
  filed_on: string | null;
  status: string;
  transaction_count: number;
  detail: string | null;
  source_url: string;
  synced_at: string;
}

interface TransactionRow {
  id: string;
  filing_id: string;
  politician_id: string | null;
  chamber: "house" | "senate";
  transaction_date: string | null;
  filed_on: string | null;
  owner: string;
  ticker: string | null;
  asset_name: string;
  asset_type: string | null;
  transaction_type: string;
  amount_min: number | null;
  amount_max: number | null;
  comment: string | null;
  source_url: string;
  synced_at: string;
}

/** Members to match filers against: the stored roster, keyed by bioguide. */
async function loadMatchableMembers(): Promise<MatchableMember[]> {
  const rows = await fetchSupabaseRows<{
    id: string;
    name: string;
    state_code: string | null;
    state: string | null;
    title: string | null;
  }>("politicians", "branch=eq.legislative&order=id.asc", {
    select: "id,name,state_code,state,title",
    cache: "no-store",
    paginateAll: true,
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    state: row.state_code || row.state,
    // Only used to separate two members who share a surname and a state.
    chamber: /senator/i.test(row.title || "") ? ("senate" as const) : ("house" as const),
  }));
}

function emptyResult(chamber: StockSyncResult["chamber"]): StockSyncResult {
  return {
    chamber,
    filingsSeen: 0,
    filingsWritten: 0,
    transactionsWritten: 0,
    byStatus: {},
    unmatchedFilers: [],
    errors: [],
  };
}

function countStatus(result: StockSyncResult, status: string) {
  result.byStatus[status] = (result.byStatus[status] || 0) + 1;
}

/**
 * Stable id for a transaction.
 *
 * Built from the filing and the row's position within it rather than from its contents: a member can
 * legitimately disclose the same asset, type and amount twice on one report, and a content hash
 * would collapse those into one row.
 */
function transactionId(filingId: string, index: number) {
  return `${filingId}-${index}`;
}

async function writeFilings(rows: FilingRow[]) {
  if (rows.length === 0) return;
  await upsertSupabaseRowsInChunks("stock_filings", rows, "id", 200);
}

async function writeTransactions(rows: TransactionRow[]) {
  if (rows.length === 0) return;
  await upsertSupabaseRowsInChunks("stock_transactions", rows, "id", 200);
}

/**
 * Clears the transactions of every filing this run touched, before rewriting them.
 *
 * Upserting alone is not enough, because a re-run can legitimately produce a *different* set of rows
 * for the same filing. Two ways that happens, both of which occurred here: a parser fix changes how
 * many transactions a document yields, leaving orphans at the higher indices; and a matcher fix
 * turns a wrongly-attributed filing into an unmatched one, which writes no transactions at all and
 * would otherwise leave the bad attribution in place forever.
 */
async function clearFilingTransactions(filingIds: string[]) {
  for (let index = 0; index < filingIds.length; index += 50) {
    const chunk = filingIds.slice(index, index + 50);
    const filter = chunk.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(",");
    await deleteSupabaseRows("stock_transactions", `filing_id=in.(${filter})`);
  }
}

function toTransactionRows(input: {
  filingId: string;
  chamber: "house" | "senate";
  politicianId: string | null;
  sourceUrl: string;
  filedOn: string | null;
  transactions: DisclosedTransaction[];
}): TransactionRow[] {
  const now = new Date().toISOString();

  return input.transactions.map((transaction, index) => ({
    id: transactionId(input.filingId, index),
    filing_id: input.filingId,
    politician_id: input.politicianId,
    chamber: input.chamber,
    transaction_date: transaction.transactionDate,
    filed_on: transaction.filedOn || input.filedOn,
    owner: transaction.owner,
    ticker: transaction.ticker,
    asset_name: transaction.assetName.slice(0, 500) || "Unnamed asset",
    asset_type: transaction.assetType,
    transaction_type: transaction.transactionType,
    amount_min: transaction.amountMin,
    amount_max: transaction.amountMax,
    comment: transaction.comment,
    source_url: input.sourceUrl,
    synced_at: now,
  }));
}

/**
 * Filings newest first, so a bounded run takes the most recent rather than the alphabetically first.
 *
 * The Clerk's index is ordered by surname. Slicing it directly meant the nightly `limit=150` only
 * ever reached Alford through Hoyle -- around 200 of the year's 351 transaction reports, everyone
 * from Hoyle to Yakym, would never have been picked up no matter how long the schedule ran. The
 * Senate search already returns newest first, which is why only this half was affected.
 *
 * The DocID is the tiebreaker: it ascends with filing order, so filings sharing a date stay in a
 * stable sequence instead of being reordered on every run.
 */
export function newestFirst(filings: HouseIndexRow[]) {
  return [...filings].sort((left, right) => {
    const byDate = (right.filingDate || "").localeCompare(left.filingDate || "");
    return byDate !== 0 ? byDate : right.docId.localeCompare(left.docId);
  });
}

/**
 * House filings for one year.
 *
 * Scans are settled from the DocID before any download, so a year of filings costs one request per
 * readable document rather than one per filing.
 */
export async function syncHouseStockYear(input: {
  year: number;
  limit?: number;
  members?: MatchableMember[];
  dryRun?: boolean;
}): Promise<StockSyncResult> {
  const result = emptyResult("house");
  const members = input.members ?? (await loadMatchableMembers());
  const index = buildFilerIndex(members);

  const filings = newestFirst(transactionReportRows(await fetchHouseFilingIndex(input.year)));
  const selected = input.limit ? filings.slice(0, input.limit) : filings;
  result.filingsSeen = selected.length;

  const filingRows: FilingRow[] = [];
  const transactionRows: TransactionRow[] = [];
  const now = new Date().toISOString();

  for (const filing of selected) {
    const filingId = `house-${filing.docId}`;
    const sourceUrl = houseTransactionReportUrl(input.year, filing.docId);
    const member = matchFiler(index, {
      first: filing.first,
      last: filing.last,
      stateDistrict: filing.stateDst,
      chamber: "house",
    });

    if (!member) {
      const label = `${filing.first} ${filing.last} (${filing.stateDst})`.trim();
      if (!result.unmatchedFilers.includes(label)) result.unmatchedFilers.push(label);
    }

    const extraction = await fetchHouseTransactions(input.year, filing.docId);
    // A filing we cannot attribute is still recorded, but as unmatched rather than parsed -- its
    // transactions have no member to hang from and would otherwise vanish without a trace.
    const status = member ? extraction.status : "unmatched_filer";
    countStatus(result, status);

    filingRows.push({
      id: filingId,
      chamber: "house",
      doc_id: filing.docId,
      politician_id: member?.id ?? null,
      filer_name: `${filing.first} ${filing.last}`.trim(),
      filer_state: filing.stateDst || null,
      filing_year: input.year,
      filed_on: filing.filingDate,
      status,
      transaction_count: extraction.status === "parsed" ? extraction.transactions.length : 0,
      detail: "detail" in extraction ? extraction.detail : null,
      source_url: sourceUrl,
      synced_at: now,
    });

    if (member && extraction.status === "parsed") {
      transactionRows.push(
        ...toTransactionRows({
          filingId,
          chamber: "house",
          politicianId: member.id,
          sourceUrl,
          filedOn: filing.filingDate,
          transactions: extraction.transactions,
        }),
      );
    }
  }

  if (!input.dryRun) {
    await writeFilings(filingRows);
    await clearFilingTransactions(filingRows.map((row) => row.id));
    await writeTransactions(transactionRows);
  }

  result.filingsWritten = filingRows.length;
  result.transactionsWritten = transactionRows.length;
  return result;
}

/** The Senate report id, which is the UUID in its URL. */
function senateDocId(row: SenateFilingRow) {
  return row.reportUrl.match(/\/([0-9a-f-]{36})\/?$/i)?.[1] || row.reportUrl;
}

/**
 * Senate filings.
 *
 * Cheaper than the House per filing: electronic reports are HTML tables, so there is no PDF work at
 * all. Paper filings are recorded as `scanned` from the search row's own link shape, before a fetch.
 */
export async function syncSenateStocks(input: {
  since?: string;
  limit?: number;
  members?: MatchableMember[];
  dryRun?: boolean;
}): Promise<StockSyncResult> {
  const result = emptyResult("senate");
  const members = input.members ?? (await loadMatchableMembers());
  const index = buildFilerIndex(members);

  const session = await openSenateSession();
  const filings = await fetchAllSenateFilings(session, { since: input.since });
  const selected = input.limit ? filings.slice(0, input.limit) : filings;
  result.filingsSeen = selected.length;

  const filingRows: FilingRow[] = [];
  const transactionRows: TransactionRow[] = [];
  const now = new Date().toISOString();

  for (const filing of selected) {
    const docId = senateDocId(filing);
    const filingId = `senate-${docId}`;
    const member = matchFiler(index, {
      first: filing.firstName,
      last: filing.lastName,
      chamber: "senate",
    });

    if (!member) {
      const label = `${filing.firstName} ${filing.lastName}`.trim();
      if (!result.unmatchedFilers.includes(label)) result.unmatchedFilers.push(label);
    }

    let status = member ? "parsed" : "unmatched_filer";
    let detail: string | null = null;
    let transactions: DisclosedTransaction[] = [];

    if (!filing.electronic) {
      status = "scanned";
    } else if (member) {
      try {
        transactions = await fetchSenateReportTransactions(session, filing.reportUrl);
        // An electronic report that yields nothing is not a paper scan; naming it separately keeps
        // a parser regression from hiding inside the expected scan count.
        if (transactions.length === 0) status = "no_text";
      } catch (error) {
        status = "extract_failed";
        detail = error instanceof Error ? error.message : String(error);
        result.errors.push(`${filingId}: ${detail}`);
      }
    }

    countStatus(result, status);

    filingRows.push({
      id: filingId,
      chamber: "senate",
      doc_id: docId,
      politician_id: member?.id ?? null,
      filer_name: `${filing.firstName} ${filing.lastName}`.trim(),
      filer_state: null,
      filing_year: filing.filedOn ? Number(filing.filedOn.slice(0, 4)) : null,
      filed_on: filing.filedOn,
      status,
      transaction_count: transactions.length,
      detail,
      source_url: filing.reportUrl,
      synced_at: now,
    });

    if (member && transactions.length > 0) {
      transactionRows.push(
        ...toTransactionRows({
          filingId,
          chamber: "senate",
          politicianId: member.id,
          sourceUrl: filing.reportUrl,
          filedOn: filing.filedOn,
          transactions,
        }),
      );
    }
  }

  if (!input.dryRun) {
    await writeFilings(filingRows);
    await clearFilingTransactions(filingRows.map((row) => row.id));
    await writeTransactions(transactionRows);
  }

  result.filingsWritten = filingRows.length;
  result.transactionsWritten = transactionRows.length;
  return result;
}

/** Merges several chamber results into one, for a run that covered both. */
export function mergeStockSyncResults(results: StockSyncResult[]): StockSyncResult {
  const merged = emptyResult("both");

  for (const result of results) {
    merged.filingsSeen += result.filingsSeen;
    merged.filingsWritten += result.filingsWritten;
    merged.transactionsWritten += result.transactionsWritten;
    merged.errors.push(...result.errors);
    for (const filer of result.unmatchedFilers) {
      if (!merged.unmatchedFilers.includes(filer)) merged.unmatchedFilers.push(filer);
    }
    for (const [status, count] of Object.entries(result.byStatus)) {
      merged.byStatus[status] = (merged.byStatus[status] || 0) + count;
    }
  }

  return merged;
}

export { loadMatchableMembers };
