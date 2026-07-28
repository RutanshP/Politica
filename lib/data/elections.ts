import { emptyResult, withData } from "@/lib/data/result";
import { listStoredElectionCandidates } from "@/lib/supabase/elections";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { resolveSortDirection, sortDirectionFactor } from "@/lib/sort-direction";
import { listStoredPoliticiansByIds } from "@/lib/supabase/politicians";
import { getLatestSyncRun } from "@/lib/supabase/sync";
import { sortLabelsAlphabetically } from "@/lib/utils";
import type { ElectionCandidate, ElectionOffice, ElectionRace } from "@/types/civic";
import type { ElectionCandidateRow } from "@/types/supabase";

export type ElectionDataSource = "supabase" | "unconfigured" | "unavailable";

// election_candidates is a weekly sync (FEC filings move at filing-deadline pace) -- the default
// 24h staleness window in buildFreshness would flag this as stale on every single page load.
const ELECTIONS_STALE_AFTER_HOURS = 24 * 8;

export interface ElectionsDirectorySearchParams {
  office?: string;
  state?: string;
  party?: string;
  sort?: string;
  dir?: string;
}

const OFFICE_LABELS: Record<ElectionOffice, string> = {
  P: "President",
  S: "Senate",
  H: "House",
};

function isElectionOffice(value: string): value is ElectionOffice {
  return value === "H" || value === "S" || value === "P";
}

function mapRowToCandidate(row: ElectionCandidateRow): ElectionCandidate {
  return {
    id: row.id,
    fecCandidateId: row.fec_candidate_id,
    name: row.name,
    party: row.party || "Unknown",
    partyFull: row.party_full || row.party || "Unknown",
    incumbentChallenge: row.incumbent_challenge || "",
    incumbentChallengeFull: row.incumbent_challenge_full || "Not specified",
    candidateStatus: row.candidate_status || "",
    candidateInactive: Boolean(row.candidate_inactive),
    politicianId: row.politician_id || undefined,
  };
}

/** Groups flat candidate rows into races keyed by office + state + district + cycle. */
function buildRaces(rows: ElectionCandidateRow[]): ElectionRace[] {
  const racesById = new Map<string, ElectionRace>();

  for (const row of rows) {
    if (!isElectionOffice(row.office)) continue;

    const raceId = `${row.office}|${row.state || ""}|${row.district || ""}|${row.cycle}`;
    const race = racesById.get(raceId);
    const candidate = mapRowToCandidate(row);

    if (race) {
      race.candidates.push(candidate);
    } else {
      racesById.set(raceId, {
        id: raceId,
        office: row.office,
        officeFull: row.office_full || OFFICE_LABELS[row.office],
        state: row.state || undefined,
        district: row.district && row.district !== "00" ? row.district : undefined,
        cycle: row.cycle,
        electionYear: row.election_year || row.cycle,
        candidates: [candidate],
      });
    }
  }

  return [...racesById.values()];
}

export async function getElectionsDirectoryData(searchParams: ElectionsDirectorySearchParams) {
  const office = isElectionOffice(searchParams.office || "") ? (searchParams.office as ElectionOffice) : "H";
  const filters = {
    office,
    state: (searchParams.state || "All states").trim(),
    party: searchParams.party || "All parties",
    sortBy: searchParams.sort || "State",
    direction: resolveSortDirection(searchParams.sort || "State", searchParams.dir),
  };

  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "election_candidates_sync", [] as ElectionRace[], "unconfigured"),
      races: [] as ElectionRace[],
      filters,
      options: { states: ["All states"], parties: ["All parties"] },
    };
  }

  try {
    const [rows, latestRun] = await Promise.all([
      listStoredElectionCandidates(),
      getLatestSyncRun("election_candidates_sync").catch(() => undefined),
    ]);

    const officeRows = rows.filter((row) => row.office === filters.office);
    const states = sortLabelsAlphabetically(officeRows.map((row) => row.state || ""));

    const filteredRows = officeRows.filter((row) => {
      const matchesState = filters.state === "All states" || row.state === filters.state;
      const matchesParty = filters.party === "All parties" || row.party === filters.party;
      return matchesState && matchesParty;
    });

    // Natural order per option; the factor reverses it when the reader has flipped direction.
    const factor = sortDirectionFactor(filters.sortBy, filters.direction);
    const races = buildRaces(filteredRows).sort((left, right) => {
      if (filters.sortBy === "Candidates") return factor * (right.candidates.length - left.candidates.length);
      const byState = (left.state || "").localeCompare(right.state || "");
      if (byState !== 0) return factor * byState;
      return factor * (left.district || "").localeCompare(right.district || "");
    });

    // election_candidates.politician_id is the bioguide id (the FK target), not the slug the
    // politician route uses -- resolve slugs for the incumbents on this page in one batch.
    const politicianIds = races.flatMap((race) =>
      race.candidates.map((candidate) => candidate.politicianId).filter((id): id is string => Boolean(id)));
    const slugById = new Map(
      (await listStoredPoliticiansByIds(politicianIds).catch(() => []))
        .map((politician) => [politician.id, politician.slug]),
    );
    for (const race of races) {
      for (const candidate of race.candidates) {
        if (candidate.politicianId) {
          candidate.politicianSlug = slugById.get(candidate.politicianId);
        }
      }
    }

    const result = withData(
      races.length > 0 ? "supabase" : "unavailable",
      "election_candidates_sync",
      races,
      latestRun?.finished_at || latestRun?.started_at,
      {
        staleAfterHours: ELECTIONS_STALE_AFTER_HOURS,
        availability: races.length > 0 ? "live" : "empty",
        detail: latestRun?.status ? `Latest sync status: ${latestRun.status}` : "No sync history yet",
      },
    );

    return {
      ...result,
      source: result.source as ElectionDataSource,
      races,
      filters,
      options: {
        states: ["All states", ...states],
        parties: ["All parties", ...sortLabelsAlphabetically(officeRows.map((row) => row.party || ""))],
      },
    };
  } catch (error) {
    return {
      ...emptyResult(
        "unavailable",
        "election_candidates_sync",
        [] as ElectionRace[],
        "unavailable",
        error instanceof Error ? error.message : "Stored election candidate read failed",
      ),
      races: [] as ElectionRace[],
      filters,
      options: { states: ["All states"], parties: ["All parties"] },
    };
  }
}

export function isLiveElectionsSource(source: string) {
  return source === "supabase";
}

export function getElectionsSourceLabel(source: string) {
  if (source === "supabase") return "Stored election candidate records";
  return source === "unconfigured" ? "Supabase is not configured" : "Election data unavailable";
}
