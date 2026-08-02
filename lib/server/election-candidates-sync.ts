import { fetchCongressLegislatorsFecIds } from "@/lib/adapters/congress-legislators";
import { fetchFecCandidatesByOfficeCycle, isFecConfigured, type FecCandidateRow } from "@/lib/adapters/fec";
import { upsertStoredElectionCandidates } from "@/lib/supabase/elections";
import type { ElectionCandidateRow } from "@/types/supabase";

// House/Senate cycles are the even year they're contested in (2026 is the current midterm cycle).
// Presidential candidates file years ahead of the actual race, so that one tracks separately --
// there is no presidential race in a midterm year.
const DEFAULT_HOUSE_SENATE_CYCLE = Number.parseInt(
  process.env.POLITICA_ELECTION_HOUSE_SENATE_CYCLE?.trim() || "2026",
  10,
);
const DEFAULT_PRESIDENTIAL_CYCLE = Number.parseInt(
  process.env.POLITICA_ELECTION_PRESIDENTIAL_CYCLE?.trim() || "2028",
  10,
);

export interface ElectionCandidatesSyncOptions {
  houseSenateCycle?: number;
  presidentialCycle?: number;
}

function toRow(
  candidate: FecCandidateRow,
  cycle: number,
  bioguideByFecId: Map<string, string>,
): ElectionCandidateRow | null {
  if (!candidate.candidate_id || !candidate.name || !candidate.office) {
    return null;
  }

  return {
    id: `${candidate.candidate_id}-${cycle}`,
    fec_candidate_id: candidate.candidate_id,
    cycle,
    // election_years often spans several cycles (a candidate tracked since an earlier filing) --
    // the most recent entry is the one relevant to "when do they next appear on a ballot."
    election_year: candidate.election_years?.at(-1) ?? cycle,
    office: candidate.office,
    office_full: candidate.office_full ?? null,
    party: candidate.party ?? null,
    party_full: candidate.party_full ?? null,
    state: candidate.state ?? null,
    district: candidate.district ?? null,
    incumbent_challenge: candidate.incumbent_challenge ?? null,
    incumbent_challenge_full: candidate.incumbent_challenge_full ?? null,
    candidate_status: candidate.candidate_status ?? null,
    candidate_inactive: candidate.candidate_inactive ?? null,
    active_through: candidate.active_through ?? null,
    name: candidate.name,
    // Only ever matches current House/Senate incumbents -- challengers, open-seat candidates, and
    // every presidential candidate correctly stay unmatched (none of those are `politicians` rows).
    politician_id: bioguideByFecId.get(candidate.candidate_id) ?? null,
    source_system: "fec",
    source_id: candidate.candidate_id,
    synced_at: new Date().toISOString(),
    // Not stored: 5.8MB across the roster, and ELECTION_CANDIDATE_SELECT does not read it back --
    // every field the app uses is already a column above. Same call as bills.raw_bill in 022.
    raw_payload: null,
  };
}

/**
 * Pulls the full federal candidate roster (House + Senate at the current midterm/general cycle,
 * President at the next presidential cycle) from FEC's /candidates/ endpoint and upserts it.
 * politician_id linking reuses the same bioguide<->FEC crosswalk lib/server/fec-funding-graph-sync.ts
 * already relies on, rather than name/state/district guessing.
 */
export async function syncElectionCandidatesFromFec(options?: ElectionCandidatesSyncOptions) {
  if (!isFecConfigured()) {
    throw new Error("FEC API is not configured");
  }

  const houseSenateCycle = options?.houseSenateCycle ?? DEFAULT_HOUSE_SENATE_CYCLE;
  const presidentialCycle = options?.presidentialCycle ?? DEFAULT_PRESIDENTIAL_CYCLE;

  const [houseCandidates, senateCandidates, requestedPresidentCandidates, fecIdsByBioguide] = await Promise.all([
    fetchFecCandidatesByOfficeCycle("H", houseSenateCycle),
    fetchFecCandidatesByOfficeCycle("S", houseSenateCycle),
    fetchFecCandidatesByOfficeCycle("P", presidentialCycle),
    fetchCongressLegislatorsFecIds(),
  ]);

  /*
   * FEC files a candidate under the cycle they are currently active in, not the race they are
   * aiming at. Until the next presidential cycle opens, everyone who has filed for it still sits
   * under the current one -- asking for 2028 in 2026 returns nothing at all. Fall back so the
   * President tab has the filed candidates now, and picks up the real cycle once FEC opens it.
   */
  const presidentialFellBack = requestedPresidentCandidates.length === 0
    && presidentialCycle !== houseSenateCycle;
  const presidentCandidates = presidentialFellBack
    ? await fetchFecCandidatesByOfficeCycle("P", houseSenateCycle)
    : requestedPresidentCandidates;
  const resolvedPresidentialCycle = presidentialFellBack ? houseSenateCycle : presidentialCycle;

  const bioguideByFecId = new Map<string, string>();
  for (const [bioguide, fecIds] of fecIdsByBioguide) {
    for (const fecId of fecIds) {
      bioguideByFecId.set(fecId, bioguide);
    }
  }

  const rows = [
    ...houseCandidates.map((candidate) => toRow(candidate, houseSenateCycle, bioguideByFecId)),
    ...senateCandidates.map((candidate) => toRow(candidate, houseSenateCycle, bioguideByFecId)),
    ...presidentCandidates.map((candidate) => toRow(candidate, resolvedPresidentialCycle, bioguideByFecId)),
  ].filter((row): row is ElectionCandidateRow => row !== null);

  if (rows.length > 0) {
    await upsertStoredElectionCandidates(rows);
  }

  return {
    candidatesSynced: rows.length,
    byOffice: {
      H: houseCandidates.length,
      S: senateCandidates.length,
      P: presidentCandidates.length,
    },
    houseSenateCycle,
    presidentialCycle: resolvedPresidentialCycle,
    presidentialCycleRequested: presidentialCycle,
    at: new Date().toISOString(),
  };
}
