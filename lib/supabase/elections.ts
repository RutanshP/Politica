import { ELECTIONS_CACHE_TAG } from "@/lib/supabase/cache-tags";
import { fetchSupabaseRows, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";
import type { ElectionCandidateRow } from "@/types/supabase";

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
