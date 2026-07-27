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
