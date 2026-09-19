import "server-only";

import {
  LDA_PAGE_SIZE,
  LdaThrottledError,
  fetchLdaFilingsPage,
  isLdaConfigured,
  normalizeLdaFiling,
} from "@/lib/adapters/lda";
import { congressForYear } from "@/lib/lobbying/lda-text";
import { purgeLobbyingGraph, upsertGraphEdges, upsertGraphEntities } from "@/lib/supabase/funding-graph";
import { fetchSupabaseRows, invokeSupabaseRpc, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";
import { slugifySegment } from "@/lib/utils";
import type { GraphEdgeRow, GraphEntityRow } from "@/types/funding-graph";

/*
 * Lobbying reports are walked in posting order from a stored cursor (lobbying_sync_state). The API
 * caps page_size at 25 and answers in about a second, so a busy filing deadline is a few hundred
 * pages; each call takes a bounded slice and advances the cursor, and a caller loops until done.
 * Paging by filing year instead was not resumable -- new filings shifted every later page.
 */
const DEFAULT_PAGE_BUDGET = 60;
const SYNC_STATE_ID = "default";

export interface LobbyingSyncResult {
  postedAfter: string;
  pagesFetched: number;
  totalPages: number;
  reportsUpserted: number;
  billMentions: number;
  skippedOtherCongress: number;
  currentRowsChanged: number;
  /** Where the next call resumes; equal to postedAfter when nothing new was posted. */
  nextPostedAfter: string;
  done: boolean;
  at: string;
}

async function fetchPageWithRetry(postedAfter: string, page: number, postedBefore?: string, attempts = 10) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchLdaFilingsPage({ postedAfter, postedBefore, page });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        // A throttle tells us exactly how long to wait; anything else gets a growing backoff.
        const wait = error instanceof LdaThrottledError ? error.retryAfterMs : 500 * attempt;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }

  throw new Error(
    `LDA page ${page} (posted after ${postedAfter}) failed after ${attempts} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/** The first day of the Congress in session: reports from before it cite bills this app does not store. */
function currentCongressStart(now = new Date()) {
  const year = now.getUTCFullYear();
  const firstYear = congressForYear(year) === congressForYear(year - 1) ? year - 1 : year;
  return { firstYear, congress: congressForYear(year) };
}

async function readCursor() {
  const rows = await fetchSupabaseRows<{ posted_after: string }>(
    "lobbying_sync_state",
    `id=eq.${SYNC_STATE_ID}`,
    { cache: "no-store", select: "posted_after", paginateTiebreaker: null },
  ).catch(() => []);
  return rows[0]?.posted_after ?? null;
}

async function listStoredBillIds() {
  const rows = await fetchSupabaseRows<{ id: string }>("bills", "order=id.asc", {
    cache: "no-store",
    paginateAll: true,
    paginateTiebreaker: null,
    select: "id",
  });
  return new Set(rows.map((row) => row.id));
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

/**
 * Ingests one slice of lobbying reports posted after the stored cursor (or `postedAfter`, which
 * also resets it). Reports are keyed on filing_uuid, so a re-run is a no-op rather than a double
 * count, and which report counts for a quarter is settled afterwards by lobbying_refresh_current.
 *
 * With `postedBefore` the slice is a closed window and the stored cursor is neither read nor
 * written -- that is how a backfill runs several windows side by side.
 */
export async function syncLobbyingFilings(options?: {
  postedAfter?: string;
  postedBefore?: string;
  pageBudget?: number;
}): Promise<LobbyingSyncResult> {
  if (!isLdaConfigured()) {
    throw new Error("POLITICA_LDA_API_KEY is not configured");
  }

  const windowed = Boolean(options?.postedBefore);
  const { firstYear, congress } = currentCongressStart();
  const postedAfter = options?.postedAfter
    || (windowed ? null : await readCursor())
    || `${firstYear}-01-01T00:00:00Z`;
  const postedBefore = options?.postedBefore;
  const pageBudget = Math.max(1, options?.pageBudget || DEFAULT_PAGE_BUDGET);
  const billIds = await listStoredBillIds();

  // The first page gives the total; the rest of the slice is fetched a few at a time, which the
  // adapter's start-time pacing keeps within the API's rate.
  const first = await fetchPageWithRetry(postedAfter, 1, postedBefore);
  const totalPages = Math.max(1, Math.ceil(first.count / LDA_PAGE_SIZE));
  const lastPage = Math.min(totalPages, pageBudget);
  const rest = await mapWithConcurrency(
    Array.from({ length: Math.max(0, lastPage - 1) }, (_, index) => index + 2),
    4,
    (page) => fetchPageWithRetry(postedAfter, page, postedBefore),
  );
  const records = [first, ...rest].flatMap((page) => page.results);

  let latestPosted: string | null = null;
  let skippedOtherCongress = 0;
  for (const record of records) {
    if (record.dt_posted && (!latestPosted || Date.parse(record.dt_posted) > Date.parse(latestPosted))) {
      latestPosted = record.dt_posted;
    }
  }
  const reports = records
    .map(normalizeLdaFiling)
    .filter((report): report is NonNullable<typeof report> => Boolean(report))
    .filter((report) => {
      const keep = congressForYear(report.filing.filing_year) === congress;
      if (!keep) skippedOtherCongress += 1;
      return keep;
    });

  await upsertSupabaseRowsInChunks("lobbying_filings", reports.map((report) => report.filing), "filing_uuid", 500);
  const mentions = reports.flatMap((report) =>
    report.billMentions
      .filter((billId) => billIds.has(billId))
      .map((billId) => ({ bill_id: billId, filing_uuid: report.filing.filing_uuid })),
  );
  if (mentions.length > 0) {
    await upsertSupabaseRowsInChunks("lobbying_bill_mentions", mentions, "bill_id,filing_uuid", 1000);
  }

  const done = lastPage >= totalPages;
  /*
   * Resume from the newest report seen, less a minute: reports posted in the same second as the
   * last one processed may sit on the next page, and re-reading a few is harmless.
   */
  const nextPostedAfter = latestPosted
    ? new Date(Date.parse(latestPosted) - 60_000).toISOString()
    : postedAfter;

  /*
   * Only the firm/client/quarter groups this slice touched are re-ranked; a whole year timed out.
   * Backfill windows skip it: running side by side they touch the same groups and deadlock, so the
   * backfill re-ranks everything once when all windows are done (lobbying_refresh_current).
   */
  let currentRowsChanged = 0;
  for (let index = 0; !windowed && index < reports.length; index += 500) {
    currentRowsChanged += await invokeSupabaseRpc<number>(
      "lobbying_refresh_current_for",
      { p_filing_uuids: reports.slice(index, index + 500).map((report) => report.filing.filing_uuid) },
      { cache: "no-store" },
    );
  }

  if (!windowed) {
    await upsertSupabaseRowsInChunks(
      "lobbying_sync_state",
      [{ id: SYNC_STATE_ID, posted_after: nextPostedAfter, updated_at: new Date().toISOString() }],
      "id",
    );
  }

  return {
    postedAfter,
    pagesFetched: lastPage,
    totalPages,
    reportsUpserted: reports.length,
    billMentions: mentions.length,
    skippedOtherCongress,
    currentRowsChanged,
    nextPostedAfter,
    done,
    at: new Date().toISOString(),
  };
}

interface LobbyingRollupRow {
  registrant_id: string;
  registrant_name: string | null;
  client_id: string;
  client_name: string | null;
  is_in_house: boolean;
  total_amount: string | number;
  filing_count: string | number;
  first_year: number;
  last_year: number;
}

export interface LobbyingGraphResult {
  relationships: number;
  firms: number;
  clients: number;
  retainedEdges: number;
  bridgedToFecEmployers: number;
  at: string;
}

/**
 * Builds the lobbying layer of the funding graph from the stored filings.
 *
 * The graph is politician-centric, and LDA filings name no politicians -- they identify the firm,
 * the client, and the money, and target a chamber or agency at most. The connection to a member
 * is therefore made through the organization: a lobbying client is frequently the same
 * organization that already appears in the FEC layer as an employer aggregate, whose employees
 * contributed to a member, who sponsors bills. Where the names line up, an `affiliated_with` edge
 * bridges the two layers so that path is traversable.
 */
export async function rebuildLobbyingGraph(years?: number[]): Promise<LobbyingGraphResult> {
  const rollup = await invokeSupabaseRpc<LobbyingRollupRow[]>(
    "lobbying_graph_rollup",
    { p_years: years ?? null },
    { cache: "no-store" },
  );

  const syncedAt = new Date().toISOString();
  const entities = new Map<string, GraphEntityRow>();
  const edges: GraphEdgeRow[] = [];

  // Existing FEC employer aggregates, to bridge lobbying clients into the politician graph.
  const employerRows = await fetchSupabaseRows<{ id: string; label: string }>(
    "graph_entities",
    "entity_type=eq.employer",
    { cache: "no-store", paginateAll: true, select: "id,label" },
  ).catch(() => []);
  const employerIds = new Set(employerRows.map((row) => row.id));

  // A true replace: drop the firm nodes and edges an earlier rebuild wrote before adding the
  // current set, so re-running never leaves stale relationships behind.
  await purgeLobbyingGraph();

  let bridged = 0;

  for (const row of rollup) {
    const amount = Math.round(Number(row.total_amount) || 0);
    const filingCount = Number(row.filing_count) || 0;
    const firmEntityId = `lda-firm-${row.registrant_id}`;

    /*
     * Connected-only. The graph is a breadth-first walk out from a politician, so a lobbying
     * client that is not an organization the FEC layer already knows as an employer aggregate is
     * an unreachable island -- no traversal can ever surface it. Those are skipped rather than
     * materialized (see the matching filter in lobbying_graph_rollup). Where it does bridge, the
     * existing employer node is reused as the client so the lobbying money joins the politician
     * layer without an extra hop past the depth cap.
     */
    const employerId = `fec-emp-${slugifySegment(row.client_name || "")}`;
    if (!row.client_name || !employerIds.has(employerId)) continue;
    const clientEntityId = employerId;
    bridged += 1;

    if (!entities.has(firmEntityId)) {
      entities.set(firmEntityId, {
        id: firmEntityId,
        slug: firmEntityId,
        entity_type: "lobbyingFirm",
        label: row.registrant_name || "Lobbying registrant",
        subtitle: "Lobbying registrant",
        image_url: null,
        metadata: { ldaRegistrantId: row.registrant_id },
        source_system: "lda_sync",
        source_id: String(row.registrant_id),
        source_url: `https://lda.gov/api/v1/registrants/${row.registrant_id}/`,
        synced_at: syncedAt,
      });
    }

    /*
     * In-house filers are their own registrant, so a client -> firm edge would be a self-loop
     * that says nothing. The bridged client is an FEC-owned employer node this rebuild does not
     * write, so there is nothing to hang the in-house figure on -- it is simply not edged.
     */
    if (row.is_in_house) {
      continue;
    }

    edges.push({
      id: `lda-retained-${row.client_id}-${row.registrant_id}`,
      source_entity_id: clientEntityId,
      target_entity_id: firmEntityId,
      relationship_type: "retained",
      relationship_direction: "directed",
      amount,
      transaction_count: filingCount,
      election_cycle: null,
      occurred_at: null,
      start_date: null,
      end_date: null,
      // One edge per client/firm pair, summed across that pair's quarterly filings.
      is_aggregate: true,
      confidence: 1,
      metadata: { firstYear: row.first_year, lastYear: row.last_year, filingCount },
      source_system: "lda_sync",
      source_id: `${row.client_id}-${row.registrant_id}`,
      source_url: "https://lda.gov/api/v1/filings/",
      synced_at: syncedAt,
    });

  }

  const entityRows = [...entities.values()];
  if (entityRows.length > 0) {
    await upsertGraphEntities(entityRows);
  }
  if (edges.length > 0) {
    await upsertGraphEdges(edges);
  }

  return {
    relationships: rollup.length,
    firms: entityRows.filter((row) => row.entity_type === "lobbyingFirm").length,
    clients: entityRows.filter((row) => row.entity_type === "company").length,
    retainedEdges: edges.filter((edge) => edge.relationship_type === "retained").length,
    bridgedToFecEmployers: bridged,
    at: new Date().toISOString(),
  };
}
