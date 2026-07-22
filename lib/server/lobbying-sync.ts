import "server-only";

import {
  LDA_MONEY_FILING_TYPES,
  LDA_PAGE_SIZE,
  LdaThrottledError,
  fetchLdaFilingsPage,
  isLdaConfigured,
  normalizeLdaFiling,
} from "@/lib/adapters/lda";
import { upsertGraphEdges, upsertGraphEntities } from "@/lib/supabase/funding-graph";
import { fetchSupabaseRows, invokeSupabaseRpc, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";
import { slugifySegment } from "@/lib/utils";
import type { GraphEdgeRow, GraphEntityRow } from "@/types/funding-graph";

/*
 * The API caps page_size at 25 and answers in roughly a second and a half, so a full year of
 * quarterly filings is a few thousand requests. The sync is therefore resumable: a caller asks
 * for a slice of pages and gets back the cursor to continue from, so a cron can advance it
 * without any single invocation running for an hour.
 */
const DEFAULT_PAGE_BUDGET = 40;
const REQUEST_CONCURRENCY = 2;

export interface LobbyingSyncResult {
  year: number;
  filingType: string;
  startPage: number;
  pagesFetched: number;
  filingsUpserted: number;
  totalPages: number;
  totalFilings: number;
  /** Null when this filing type is fully ingested for the year. */
  nextPage: number | null;
  nextFilingType: string | null;
  at: string;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
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

async function fetchPageWithRetry(year: number, filingType: string, page: number, attempts = 6) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchLdaFilingsPage({ year, filingType, page });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        // A throttle tells us exactly how long to wait; anything else gets a growing backoff.
        const wait = error instanceof LdaThrottledError
          ? error.retryAfterMs
          : 500 * attempt;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }

  throw new Error(
    `LDA page ${page} (${year} ${filingType}) failed after ${attempts} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/**
 * Ingests one slice of quarterly lobbying filings.
 *
 * Filings are stored as rows keyed on filing_uuid, so re-running a page is a no-op rather than a
 * double count -- the graph totals are computed from these rows afterwards, never incremented
 * during ingestion.
 */
export async function syncLobbyingFilings(options: {
  year: number;
  filingType?: string;
  startPage?: number;
  pageBudget?: number;
}): Promise<LobbyingSyncResult> {
  if (!isLdaConfigured()) {
    throw new Error("POLITICA_LDA_API_KEY is not configured");
  }

  const filingType = options.filingType || LDA_MONEY_FILING_TYPES[0];
  const startPage = Math.max(1, options.startPage || 1);
  const pageBudget = Math.max(1, options.pageBudget || DEFAULT_PAGE_BUDGET);

  // Retried like every other page: an unretried head request meant a single throttle failed the
  // whole slice, and the driver then retried the slice from scratch in a loop.
  const head = await fetchPageWithRetry(options.year, filingType, startPage);
  const totalFilings = head.count;
  const totalPages = Math.max(1, Math.ceil(totalFilings / LDA_PAGE_SIZE));

  const pages = [startPage];
  for (let page = startPage + 1; page < startPage + pageBudget && page <= totalPages; page += 1) {
    pages.push(page);
  }

  /*
   * Retry rather than swallow. An earlier version caught page failures and substituted an empty
   * result, so a slice that lost 76 of 100 pages still reported success and advanced the cursor
   * past the gap -- silent data loss that only showed up as a suspiciously low upsert count.
   */
  const pageResults = await mapWithConcurrency(pages.slice(1), REQUEST_CONCURRENCY, (page) =>
    fetchPageWithRetry(options.year, filingType, page),
  );

  const normalized = [head, ...pageResults]
    .flatMap((page) => page.results)
    .map(normalizeLdaFiling)
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  /*
   * Deduplicated before writing. LDA pages are not a stable snapshot -- filings shift between
   * pages as new ones are posted, so one slice can return the same filing_uuid twice. Postgres
   * rejects that outright ("ON CONFLICT DO UPDATE command cannot affect row a second time"), and
   * the whole batch failed with a 500, which is what kept stalling the ingest.
   */
  const byUuid = new Map(normalized.map((row) => [row.filing_uuid, row]));
  const rows = [...byUuid.values()];

  if (rows.length > 0) {
    await upsertSupabaseRowsInChunks("lobbying_filings", rows, "filing_uuid", 250);
  }

  const lastPage = pages[pages.length - 1];
  const morePages = lastPage < totalPages;
  const typeIndex = LDA_MONEY_FILING_TYPES.indexOf(
    filingType as (typeof LDA_MONEY_FILING_TYPES)[number],
  );
  const nextFilingType = morePages
    ? filingType
    : LDA_MONEY_FILING_TYPES[typeIndex + 1] ?? null;

  return {
    year: options.year,
    filingType,
    startPage,
    pagesFetched: pages.length,
    filingsUpserted: rows.length,
    totalPages,
    totalFilings,
    nextPage: morePages ? lastPage + 1 : nextFilingType ? 1 : null,
    nextFilingType,
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

  let bridged = 0;

  for (const row of rollup) {
    const amount = Math.round(Number(row.total_amount) || 0);
    const filingCount = Number(row.filing_count) || 0;
    const firmEntityId = `lda-firm-${row.registrant_id}`;

    /*
     * Where the lobbying client is an organization the FEC layer already knows as an employer
     * aggregate, reuse that node rather than adding a parallel one joined by a bridge edge. They
     * are the same organization, and every extra hop matters: the graph is a breadth-first walk
     * out from a politician with a hard depth cap, so a redundant node can push the lobbying
     * layer past the horizon entirely.
     */
    const employerId = `fec-emp-${slugifySegment(row.client_name || "")}`;
    const matchesEmployer = Boolean(row.client_name) && employerIds.has(employerId);
    const clientEntityId = matchesEmployer ? employerId : `lda-client-${row.client_id}`;
    if (matchesEmployer) bridged += 1;

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

    // A matched employer node already exists and is owned by the FEC sync; don't overwrite it.
    if (!matchesEmployer && !entities.has(clientEntityId)) {
      entities.set(clientEntityId, {
        id: clientEntityId,
        slug: clientEntityId,
        entity_type: "company",
        label: row.client_name || "Lobbying client",
        subtitle: row.is_in_house ? "Lobbies in-house" : "Lobbying client",
        image_url: null,
        metadata: { ldaClientId: row.client_id, inHouse: row.is_in_house },
        source_system: "lda_sync",
        source_id: String(row.client_id),
        source_url: `https://lda.gov/api/v1/clients/${row.client_id}/`,
        synced_at: syncedAt,
      });
    }

    /*
     * In-house filers are their own registrant, so a client -> firm edge would be a self-loop
     * that says nothing. The money still matters, so it is carried on the client entity instead.
     */
    if (row.is_in_house) {
      const client = entities.get(clientEntityId);
      if (client) {
        client.metadata = { ...(client.metadata as object), inHouseSpend: amount, filingCount };
      }
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
