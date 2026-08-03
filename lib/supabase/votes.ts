import { classifyVote } from "@/lib/vote-classification";
import {
  deleteSupabaseRows,
  fetchSupabasePage,
  fetchSupabaseRows,
  invokeSupabaseRpc,
  upsertSupabaseRowsInChunks,
} from "@/lib/supabase/rest";
import { VOTES_CACHE_TAG } from "@/lib/supabase/cache-tags";
import type { VotePosition, Vote } from "@/types/civic";
import type { VotePositionRow, VoteRow } from "@/types/supabase";
import { normalizePartyLabel, normalizeStateLabel } from "@/lib/utils";

const votePositionStatSelect = "vote_id,politician_id,party,vote";
// Excludes raw_payload -- an unused-in-UI blob column on the largest table in the database
// (345k+ rows). Fetching it by default via select=* on every vote/politician page view was a
// major, uncached (cache: "no-store") egress driver. As of 023 the column is also permanently
// null: it was 83MB of per-voter duplicates of the columns beside it, so `rawAvailable` below is
// now false for the same reason twice over.
const votePositionDisplaySelect = "vote_id,politician_id,name,party,state,vote,source_system,source_id,synced_at";
const voteDisplaySelect = "id,bill_id,canonical_id,bill_number,title,question,description,amendment_number,amendment_sponsor,amendment_url,chamber,date_label,action_time,voted_on,result,yea,nay,present,not_voting,source_system,source_id,synced_at";

/**
 * Vote lists are ordered by the parsed timestamp, never by `date_label`.
 *
 * date_label is display text, and the two chambers do not even format it the same way ("September
 * 9, 2025,  12:48 PM" in the Senate, "Sep 9, 2025" in the House). Ordering by that string sorts
 * alphabetically: September above October above March, so a member's "recent votes" opened on
 * September 2025 while their October 2025 and 2026 votes sat further down the list. Same trap as
 * bills.last_action_at vs last_action_on.
 */
const VOTE_ORDER_RECENT_FIRST = "order=voted_on.desc.nullslast";

/**
 * vote_positions has no `id` column; (vote_id, politician_id) is the primary key. Every read here
 * orders by vote_id, which is nowhere near unique -- one roll call carries ~430 positions, so a
 * 100-vote chunk pages through ~43,000 rows. Without this the pages overlapped and dropped
 * positions, which silently corrupts both the member vote tables and the party-alignment stats.
 */
const VOTE_POSITION_TIEBREAKER = "politician_id";

function buildQuotedInFilter(values: string[]) {
  return values
    .map((value) => `"${value.replace(/"/g, '\\"')}"`)
    .join(",");
}

function mapRowToVotePosition(row: VotePositionRow): VotePosition {
  return {
    politicianId: row.politician_id,
    name: row.name,
    party: normalizePartyLabel(row.party),
    state: normalizeStateLabel(row.state),
    vote: row.vote,
    sourceMetadata: {
      sourceSystem: row.source_system,
      sourceId: row.source_id,
      syncedAt: row.synced_at,
      rawAvailable: Boolean(row.raw_payload),
    },
  };
}

function mapRowToVote(row: VoteRow, positions: VotePositionRow[]): Vote {
  return {
    id: row.id,
    canonicalId: row.canonical_id || undefined,
    billId: row.bill_id || undefined,
    billNumber: row.bill_number,
    title: row.title,
    question: row.question || undefined,
    description: row.description || undefined,
    amendmentNumber: row.amendment_number || undefined,
    amendmentSponsor: row.amendment_sponsor || undefined,
    amendmentUrl: row.amendment_url || undefined,
    chamber: row.chamber,
    dateLabel: row.date_label,
    actionTime: row.action_time || undefined,
    result: row.result,
    yea: row.yea,
    nay: row.nay,
    present: row.present,
    notVoting: row.not_voting,
    category: classifyVote(row.title, { billNumber: row.bill_number, result: row.result }),
    positions: positions.map(mapRowToVotePosition),
    sourceMetadata: {
      sourceSystem: row.source_system,
      sourceId: row.source_id,
      syncedAt: row.synced_at,
      rawAvailable: Boolean(row.raw_payload),
    },
  };
}

// Page-rendering-only variant of listStoredVotePositionsByVoteIds -- that function is also called
// from the federal/state sync pipelines (legislation-sync.ts, state-sync.ts), which genuinely
// need current DB state, so it stays on cache: "no-store". Every sync route already calls
// revalidateTag(VOTES_CACHE_TAG) on write, so cached reads here refresh on sync, not per request.
async function listCachedVotePositionsByVoteIds(voteIds: string[]) {
  if (voteIds.length === 0) {
    return [] as VotePositionRow[];
  }

  const chunkSize = 100;
  const rows: VotePositionRow[] = [];
  for (let index = 0; index < voteIds.length; index += chunkSize) {
    const chunk = voteIds.slice(index, index + chunkSize);
    const result = await fetchSupabaseRows<VotePositionRow>(
      "vote_positions",
      `vote_id=in.(${buildQuotedInFilter(chunk)})&order=vote_id.asc,name.asc`,
      { paginateAll: true, paginateTiebreaker: VOTE_POSITION_TIEBREAKER, select: votePositionDisplaySelect, tags: [VOTES_CACHE_TAG] },
    );
    rows.push(...result);
  }

  return rows;
}

// Fetch votes by id in chunks. A member can have hundreds of stored positions,
// and a single `id=in.(...)` filter for all of them produces a multi-kilobyte
// URL that, with the auth/Range headers, overflows undici's header-size limit
// (UND_ERR_HEADERS_OVERFLOW) and makes the whole read throw. Chunking keeps each
// request small. Results are re-sorted to preserve the global date ordering.
/** Most recent first; a vote with no parsed timestamp sorts last rather than to the top. */
function compareVotesRecentFirst(left: VoteRow, right: VoteRow) {
  const leftTime = left.voted_on ? Date.parse(left.voted_on) : Number.NaN;
  const rightTime = right.voted_on ? Date.parse(right.voted_on) : Number.NaN;
  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
  if (Number.isNaN(leftTime)) return 1;
  if (Number.isNaN(rightTime)) return -1;
  return rightTime - leftTime;
}

async function listVotesByIds(voteIds: string[]) {
  if (voteIds.length === 0) return [] as VoteRow[];
  const chunkSize = 100;
  const rows: VoteRow[] = [];
  for (let index = 0; index < voteIds.length; index += chunkSize) {
    const chunk = voteIds.slice(index, index + chunkSize);
    const result = await fetchSupabaseRows<VoteRow>(
      "votes",
      `id=in.(${buildQuotedInFilter(chunk)})&${VOTE_ORDER_RECENT_FIRST}`,
      { paginateAll: true, select: voteDisplaySelect, tags: [VOTES_CACHE_TAG] },
    );
    rows.push(...result);
  }
  // Each chunk came back sorted on its own; this restores a single order across all of them.
  rows.sort(compareVotesRecentFirst);
  return rows;
}

export async function listStoredVotes() {
  const voteRows = await fetchSupabaseRows<VoteRow>("votes", VOTE_ORDER_RECENT_FIRST, { paginateAll: true, select: voteDisplaySelect, tags: [VOTES_CACHE_TAG] });
  const positionRows = await listCachedVotePositionsByVoteIds(voteRows.map((row) => row.id));

  const positionsByVoteId = new Map<string, VotePositionRow[]>();
  for (const row of positionRows) {
    const items = positionsByVoteId.get(row.vote_id) || [];
    items.push(row);
    positionsByVoteId.set(row.vote_id, items);
  }

  return voteRows.map((row) => mapRowToVote(row, positionsByVoteId.get(row.id) || []));
}

export async function listStoredVotesByBillId(billId: string) {
  const voteRows = await fetchSupabaseRows<VoteRow>("votes", `bill_id=eq.${encodeURIComponent(billId)}&${VOTE_ORDER_RECENT_FIRST}`, { paginateAll: true, select: voteDisplaySelect, tags: [VOTES_CACHE_TAG] });
  const wantedVoteIds = new Set(voteRows.map((row) => row.id));
  const positionRows = await listCachedVotePositionsByVoteIds([...wantedVoteIds]);
  const positionsByVoteId = new Map<string, VotePositionRow[]>();
  for (const row of positionRows) {
    if (!wantedVoteIds.has(row.vote_id)) continue;
    const items = positionsByVoteId.get(row.vote_id) || [];
    items.push(row);
    positionsByVoteId.set(row.vote_id, items);
  }

  return voteRows.map((row) => mapRowToVote(row, positionsByVoteId.get(row.id) || []));
}

export async function listStoredVotesByPoliticianId(politicianId: string) {
  const positionRows = await fetchSupabaseRows<VotePositionRow>(
    "vote_positions",
    `politician_id=eq.${encodeURIComponent(politicianId)}&order=vote_id.asc`,
    { paginateAll: true, paginateTiebreaker: VOTE_POSITION_TIEBREAKER, select: votePositionDisplaySelect, tags: [VOTES_CACHE_TAG] },
  );

  const voteIds = [...new Set(positionRows.map((row) => row.vote_id))];
  if (voteIds.length === 0) {
    return [];
  }

  const voteRows = await listVotesByIds(voteIds);

  const positionsByVoteId = new Map<string, VotePositionRow[]>();
  for (const row of positionRows) {
    const items = positionsByVoteId.get(row.vote_id) || [];
    items.push(row);
    positionsByVoteId.set(row.vote_id, items);
  }

  return voteRows.map((row) => mapRowToVote(row, positionsByVoteId.get(row.id) || []));
}

export async function listStoredVotePositionContextByPoliticianId(politicianId: string) {
  const positionRows = await fetchSupabaseRows<VotePositionRow>(
    "vote_positions",
    `politician_id=eq.${encodeURIComponent(politicianId)}&order=vote_id.asc`,
    { paginateAll: true, paginateTiebreaker: VOTE_POSITION_TIEBREAKER, select: votePositionDisplaySelect, tags: [VOTES_CACHE_TAG] },
  );

  const voteIds = [...new Set(positionRows.map((row) => row.vote_id))];
  if (voteIds.length === 0) {
    return [];
  }

  // Chunked to avoid the multi-kilobyte `vote_id=in.(...)` URL overflowing
  // undici's header limit; see listVotesByIds.
  return listCachedVotePositionsByVoteIds(voteIds);
}

export async function listStoredVotePositionContextByPoliticianIds(politicianIds: string[]) {
  if (politicianIds.length === 0) {
    return [] as VotePositionRow[];
  }

  const chunkSize = 50;
  const politicianPositionRows: VotePositionRow[] = [];

  for (let index = 0; index < politicianIds.length; index += chunkSize) {
    const chunk = politicianIds.slice(index, index + chunkSize);
    const rows = await fetchSupabaseRows<VotePositionRow>(
      "vote_positions",
      `politician_id=in.(${buildQuotedInFilter(chunk)})&order=vote_id.asc`,
      { cache: "no-store", paginateAll: true, paginateTiebreaker: VOTE_POSITION_TIEBREAKER, select: votePositionDisplaySelect },
    );
    politicianPositionRows.push(...rows);
  }

  const voteIds = [...new Set(politicianPositionRows.map((row) => row.vote_id))];
  if (voteIds.length === 0) {
    return [];
  }

  return listStoredVotePositionsByVoteIds(voteIds);
}

export async function listStoredVoteHeaders() {
  return fetchSupabaseRows<Pick<VoteRow, "id" | "canonical_id" | "source_system" | "bill_id">>(
    "votes",
    "order=id.asc",
    {
      cache: "no-store",
      select: "id,canonical_id,source_system,bill_id",
      paginateAll: true,
    },
  );
}

export async function listStoredVoteHeadersByBillIds(billIds: string[]) {
  if (billIds.length === 0) {
    return [] as Array<Pick<VoteRow, "id" | "canonical_id" | "source_system" | "bill_id">>;
  }

  const chunkSize = 100;
  const rows: Array<Pick<VoteRow, "id" | "canonical_id" | "source_system" | "bill_id">> = [];

  for (let index = 0; index < billIds.length; index += chunkSize) {
    const chunk = billIds.slice(index, index + chunkSize);
    const result = await fetchSupabaseRows<Pick<VoteRow, "id" | "canonical_id" | "source_system" | "bill_id">>(
      "votes",
      `bill_id=in.(${buildQuotedInFilter(chunk)})&order=id.asc`,
      {
        cache: "no-store",
        select: "id,canonical_id,source_system,bill_id",
        paginateAll: true,
      },
    );
    rows.push(...result);
  }

  return rows;
}

/**
 * Federal roll calls to re-fetch, the ones that most need it first.
 *
 * Ordered by `question` nulls-first, then oldest-synced. That ordering is what makes the refresh
 * self-advancing: a scheduled job can call it with a fixed offset=0 forever and still walk the
 * whole table, because each run fixes its rows and they stop sorting to the front. Ordering by
 * `id.asc` instead meant a nightly job with a fixed offset re-fetched the same page every night,
 * which is why the backfill had to be driven by hand.
 *
 * Once nothing is missing a question it degrades to a staleness rotation, which is what a periodic
 * re-fetch wants anyway.
 */
export async function listStoredFederalVoteHeadersPage(limit: number, offset: number) {
  return fetchSupabasePage<Pick<VoteRow, "id" | "canonical_id" | "source_system" | "bill_id">>(
    "votes",
    "source_system=in.(house_clerk,senate_lis)&order=question.asc.nullsfirst,synced_at.asc,id.asc",
    {
      cache: "no-store",
      select: "id,canonical_id,source_system,bill_id",
      limit,
      offset,
    },
  );
}

export async function listStoredVotePositionsByVoteIds(voteIds: string[]) {
  if (voteIds.length === 0) {
    return [] as VotePositionRow[];
  }

  const chunkSize = 100;
  const rows: VotePositionRow[] = [];
  for (let index = 0; index < voteIds.length; index += chunkSize) {
    const chunk = voteIds.slice(index, index + chunkSize);
    const result = await fetchSupabaseRows<VotePositionRow>(
      "vote_positions",
      `vote_id=in.(${buildQuotedInFilter(chunk)})&order=vote_id.asc,name.asc`,
      { cache: "no-store", paginateAll: true, paginateTiebreaker: VOTE_POSITION_TIEBREAKER, select: votePositionDisplaySelect },
    );
    rows.push(...result);
  }

  return rows;
}

export async function listStoredVoteStatContextByPoliticianIds(politicianIds: string[]) {
  if (politicianIds.length === 0) {
    return [] as Pick<VotePositionRow, "vote_id" | "politician_id" | "party" | "vote">[];
  }

  const chunkSize = 50;
  const politicianPositionRows: Pick<VotePositionRow, "vote_id" | "politician_id" | "party" | "vote">[] = [];

  for (let index = 0; index < politicianIds.length; index += chunkSize) {
    const chunk = politicianIds.slice(index, index + chunkSize);
    const rows = await fetchSupabaseRows<Pick<VotePositionRow, "vote_id" | "politician_id" | "party" | "vote">>(
      "vote_positions",
      `politician_id=in.(${buildQuotedInFilter(chunk)})&order=vote_id.asc`,
      { cache: "no-store", paginateAll: true, paginateTiebreaker: VOTE_POSITION_TIEBREAKER, select: votePositionStatSelect },
    );
    politicianPositionRows.push(...rows);
  }

  const voteIds = [...new Set(politicianPositionRows.map((row) => row.vote_id))];
  if (voteIds.length === 0) {
    return [];
  }

  const rows: Pick<VotePositionRow, "vote_id" | "politician_id" | "party" | "vote">[] = [];

  for (let index = 0; index < voteIds.length; index += 100) {
    const chunk = voteIds.slice(index, index + 100);
    const result = await fetchSupabaseRows<Pick<VotePositionRow, "vote_id" | "politician_id" | "party" | "vote">>(
      "vote_positions",
      `vote_id=in.(${buildQuotedInFilter(chunk)})&order=vote_id.asc`,
      { cache: "no-store", paginateAll: true, paginateTiebreaker: VOTE_POSITION_TIEBREAKER, select: votePositionStatSelect },
    );
    rows.push(...result);
  }

  return rows;
}

export async function replaceStoredVotes(voteIds: string[], voteRows: VoteRow[], positionRows: VotePositionRow[]) {
  const chunkSize = 100;

  for (let index = 0; index < voteIds.length; index += chunkSize) {
    const chunk = voteIds.slice(index, index + chunkSize);
    await deleteSupabaseRows("vote_positions", `vote_id=in.(${buildQuotedInFilter(chunk)})`);
    await deleteSupabaseRows("votes", `id=in.(${buildQuotedInFilter(chunk)})`);
  }

  const storedVotes = voteRows.length > 0
    ? await upsertSupabaseRowsInChunks("votes", voteRows, "id", 100)
    : [];
  if (positionRows.length > 0) {
    await upsertSupabaseRowsInChunks("vote_positions", positionRows, "vote_id,politician_id", 250);
  }

  return storedVotes;
}

export async function appendStoredVotes(voteRows: VoteRow[], positionRows: VotePositionRow[]) {
  const storedVotes = voteRows.length > 0
    ? await upsertSupabaseRowsInChunks("votes", voteRows, "id", 100)
    : [];

  if (positionRows.length > 0) {
    await upsertSupabaseRowsInChunks("vote_positions", positionRows, "vote_id,politician_id", 250);
  }

  return storedVotes;
}

export interface PoliticianVoteStatCounterRow {
  politician_id: string;
  total_votes: number;
  cast_votes: number;
  with_party_count: number;
  against_party_count: number;
}

/**
 * Recomputes vote-stat counters from `vote_positions`, aggregating in Postgres so only the
 * per-member totals cross the wire rather than 358k position rows.
 *
 * Pass the affected ids after a sync; omit them to recompute everything (the reconcile job).
 * Always `no-store` -- this runs right after a write and must not read a cached pre-write result.
 */
export async function fetchPoliticianVoteStatCounters(politicianIds?: string[]) {
  if (politicianIds && politicianIds.length === 0) {
    return [] as PoliticianVoteStatCounterRow[];
  }

  return invokeSupabaseRpc<PoliticianVoteStatCounterRow[]>(
    "politician_vote_stat_counters",
    { p_politician_ids: politicianIds ?? null },
    { cache: "no-store" },
  );
}
