import { ELECTIONS_CACHE_TAG } from "@/lib/supabase/cache-tags";
import { fetchSupabaseRows, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";
import type { CandidateFinanceSnapshotRow, ElectionCandidateRow } from "@/types/supabase";

const ELECTION_CANDIDATE_SELECT = [
  "id", "fec_candidate_id", "cycle", "election_year", "office", "office_full",
  "party", "party_full", "state", "district", "incumbent_challenge", "incumbent_challenge_full",
  "candidate_status", "candidate_inactive", "active_through", "name", "politician_id",
  "source_system", "source_id", "synced_at",
].join(",");

export async function listStoredElectionCandidates(options?: { fresh?: boolean }) {
  return fetchSupabaseRows<ElectionCandidateRow>("election_candidates", undefined, {
    ...(options?.fresh ? { cache: "no-store" as const } : { tags: [ELECTIONS_CACHE_TAG] }),
    select: ELECTION_CANDIDATE_SELECT,
    paginateAll: true,
  });
}

export async function upsertStoredElectionCandidates(rows: ElectionCandidateRow[]) {
  return upsertSupabaseRowsInChunks("election_candidates", rows, "id");
}

/**
 * Only the columns the races view renders. The full row carries `raw_payload`, and pulling 2,460
 * of those to draw a directory would be most of a megabyte of egress per cold render.
 */
const ELECTION_RACE_SELECT = [
  "id", "fec_candidate_id", "office", "state", "district", "name",
  "party", "party_full", "incumbent_challenge", "politician_id", "election_year",
].join(",");

/**
 * The candidates actually on the ballot for a cycle.
 *
 * Three filters do real work here, and the row count collapses from 8,492 to ~2,460 without them
 * being cosmetic:
 *
 * - `candidate_status=C` keeps statutory candidates. The feed also carries N (not yet a
 *   candidate), P (prior cycle) and F (future), which are filings, not a ballot.
 * - `candidate_inactive=false` drops withdrawals.
 * - `election_year` is what separates "up this cycle" from "has an open committee". A senator
 *   mid-term files under cycle 2026 with an election_year of 2028; without this, every sitting
 *   senator would appear to be defending their seat this November.
 */
export async function listStoredElectionRaceCandidates(cycle: number) {
  return fetchSupabaseRows<ElectionCandidateRow>(
    "election_candidates",
    `cycle=eq.${cycle}`
      + `&election_year=eq.${cycle}`
      + "&candidate_status=eq.C"
      + "&candidate_inactive=is.false"
      + "&order=state.asc,office.asc,district.asc,name.asc",
    { tags: [ELECTIONS_CACHE_TAG], select: ELECTION_RACE_SELECT, paginateAll: true },
  );
}

/**
 * Money raised, for the candidates in one race.
 *
 * Snapshots are keyed on `politician_id`, which only sitting members have -- so this answers for
 * incumbents and returns nothing for challengers. Callers must render that absence as "not
 * reported here" rather than as $0, which would read as a candidate who raised nothing.
 *
 * `cash_on_hand` is deliberately not selected: it is 0 on all 516 stored snapshots because the
 * finance sync never populates it, and rendering that would tell every incumbent they have
 * nothing banked. Receipts and disbursements are populated on every row.
 */
export async function listStoredCandidateFinance(politicianIds: string[], cycle: number) {
  const ids = [...new Set(politicianIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const inList = ids.map((id) => `"${id.replace(/"/g, "")}"`).join(",");
  return fetchSupabaseRows<CandidateFinanceSnapshotRow>(
    "candidate_finance_snapshots",
    `politician_id=in.(${encodeURIComponent(inList)})`
      + `&election_cycle=eq.${encodeURIComponent(String(cycle))}`,
    {
      tags: [ELECTIONS_CACHE_TAG],
      select: "politician_id,election_cycle,receipts,disbursements",
    },
  );
}

/**
 * Candidacies filed by one sitting member. Scoped to a single politician so the tenure tab does
 * not pull the whole 8k-row roster to answer a question about one person.
 */
export async function listStoredElectionCandidatesByPoliticianId(politicianId: string) {
  return fetchSupabaseRows<ElectionCandidateRow>(
    "election_candidates",
    `politician_id=eq.${encodeURIComponent(politicianId)}&order=cycle.desc`,
    { tags: [ELECTIONS_CACHE_TAG], select: ELECTION_CANDIDATE_SELECT },
  );
}

/**
 * Whether the candidate sync has any data for a cycle at all.
 *
 * Without this, an empty result for a member reads as "did not file" when the truth is that
 * nobody has synced that cycle -- a senator whose next election is 2030 would be reported as
 * not running, from no data whatsoever.
 */
export async function hasStoredElectionCandidatesForCycle(cycle: number) {
  const rows = await fetchSupabaseRows<{ id: string }>(
    "election_candidates",
    `cycle=eq.${cycle}&limit=1`,
    { tags: [ELECTIONS_CACHE_TAG], select: "id" },
  );
  return rows.length > 0;
}
