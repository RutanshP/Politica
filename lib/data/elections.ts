import { emptyResult, withData } from "@/lib/data/result";
import {
  ELECTIONS_STALE_AFTER_HOURS,
  ELECTION_CYCLE,
  buildRaces,
  daysUntil,
  generalElectionDate,
  type ElectionRace,
} from "@/lib/elections";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  listStoredCandidateFinance,
  listStoredElectionRaceCandidates,
} from "@/lib/supabase/elections";
import { listStoredPoliticiansByIds } from "@/lib/supabase/politicians";
import { getLatestSyncRun } from "@/lib/supabase/sync";

export type ElectionsDataSource = "supabase" | "unconfigured" | "unavailable";

const PIPELINE = "election_candidates_sync";

export function getElectionsSourceLabel(source: ElectionsDataSource) {
  if (source === "supabase") return "Stored FEC filings";
  if (source === "unconfigured") return "Not configured";
  return "Unavailable";
}

export function isLiveElectionsSource(source: ElectionsDataSource) {
  return source === "supabase";
}

/** What the directory renders per race -- the full candidate list stays on the detail page. */
export interface ElectionRaceSummary {
  id: string;
  office: string;
  officeLabel: string;
  stateCode: string;
  stateLabel: string;
  seat: string;
  label: string;
  candidateCount: number;
  isOpenSeat: boolean;
  districtStated: boolean;
  partiesContesting: string[];
  incumbentName?: string;
  incumbentParty?: string;
  incumbentPoliticianId?: string | null;
}

function toSummary(race: ElectionRace): ElectionRaceSummary {
  return {
    id: race.id,
    office: race.office,
    officeLabel: race.officeLabel,
    stateCode: race.stateCode,
    stateLabel: race.stateLabel,
    seat: race.seat,
    label: race.label,
    candidateCount: race.candidates.length,
    isOpenSeat: race.isOpenSeat,
    districtStated: race.districtStated,
    partiesContesting: race.partiesContesting,
    incumbentName: race.incumbent?.name,
    incumbentParty: race.incumbent?.party,
    incumbentPoliticianId: race.incumbent?.politicianId,
  };
}

/**
 * Both this and the race detail call listStoredElectionRaceCandidates(cycle) for the whole cycle.
 * That is one tagged, 6-hour-cached Supabase read shared by every elections route, so the detail
 * page costs nothing extra once the directory has warmed it -- cheaper than a per-race query that
 * would miss the cache on every distinct seat.
 */
async function loadRaces() {
  const [rows, run] = await Promise.all([
    listStoredElectionRaceCandidates(ELECTION_CYCLE),
    getLatestSyncRun(PIPELINE).catch(() => undefined),
  ]);
  return { races: buildRaces(rows), run };
}

function electionContext() {
  const electionDate = generalElectionDate(ELECTION_CYCLE);
  return {
    cycle: ELECTION_CYCLE,
    electionDate: electionDate.toISOString(),
    daysRemaining: daysUntil(electionDate),
  };
}

export async function getElectionsData() {
  const context = electionContext();

  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", PIPELINE, [] as ElectionRaceSummary[], "unconfigured"),
      source: "unconfigured" as ElectionsDataSource,
      races: [] as ElectionRaceSummary[],
      states: [] as string[],
      ...context,
    };
  }

  try {
    const { races, run } = await loadRaces();
    const summaries = races.map(toSummary);
    const result = withData(
      summaries.length > 0 ? "supabase" : "unavailable",
      PIPELINE,
      summaries,
      run?.finished_at || run?.started_at,
      {
        staleAfterHours: ELECTIONS_STALE_AFTER_HOURS,
        availability: summaries.length > 0 ? "live" : "empty",
        detail: run?.status ? `Latest sync status: ${run.status}` : "No sync history yet",
      },
    );

    return {
      ...result,
      source: result.source as ElectionsDataSource,
      races: summaries,
      states: [...new Set(summaries.map((race) => race.stateCode))].filter(Boolean).sort(),
      ...context,
    };
  } catch (error) {
    return {
      ...emptyResult(
        "unavailable",
        PIPELINE,
        [] as ElectionRaceSummary[],
        "unavailable",
        error instanceof Error ? error.message : "Stored election read failed",
      ),
      source: "unavailable" as ElectionsDataSource,
      races: [] as ElectionRaceSummary[],
      states: [] as string[],
      ...context,
    };
  }
}

export interface RaceCandidateWithMoney {
  id: string;
  name: string;
  party: string;
  standing: "incumbent" | "challenger" | "open" | "unknown";
  politicianId: string | null;
  /**
   * Profile route segment. The politician route resolves on slug only, so a bioguide id links
   * to a 404 -- an incumbent is only linked once their slug has actually been looked up.
   */
  politicianSlug?: string;
  /** Undefined means no snapshot exists -- not that the candidate raised nothing. */
  receipts?: number;
  disbursements?: number;
}

export async function getElectionRaceData(raceId: string) {
  const context = electionContext();

  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", PIPELINE, undefined, "unconfigured"),
      source: "unconfigured" as ElectionsDataSource,
      race: undefined,
      candidates: [] as RaceCandidateWithMoney[],
      ...context,
    };
  }

  try {
    const { races, run } = await loadRaces();
    const race = races.find((candidate) => candidate.id === raceId);

    if (!race) {
      return {
        ...emptyResult("supabase", PIPELINE, undefined, "empty"),
        source: "supabase" as ElectionsDataSource,
        race: undefined,
        candidates: [] as RaceCandidateWithMoney[],
        ...context,
      };
    }

    const politicianIds = race.candidates
      .map((candidate) => candidate.politicianId)
      .filter((id): id is string => Boolean(id));
    const [finance, linkedPoliticians] = await Promise.all([
      listStoredCandidateFinance(politicianIds, ELECTION_CYCLE).catch(() => []),
      listStoredPoliticiansByIds(politicianIds).catch(() => []),
    ]);
    const moneyById = new Map(finance.map((row) => [row.politician_id, row]));
    const slugById = new Map(linkedPoliticians.map((person) => [person.id, person.slug]));

    const candidates: RaceCandidateWithMoney[] = race.candidates.map((candidate) => {
      const money = candidate.politicianId ? moneyById.get(candidate.politicianId) : undefined;
      return {
        id: candidate.id,
        name: candidate.name,
        party: candidate.party,
        standing: candidate.standing,
        politicianId: candidate.politicianId,
        politicianSlug: candidate.politicianId ? slugById.get(candidate.politicianId) : undefined,
        receipts: money?.receipts,
        disbursements: money?.disbursements,
      };
    });

    const result = withData(
      "supabase",
      PIPELINE,
      race,
      run?.finished_at || run?.started_at,
      {
        staleAfterHours: ELECTIONS_STALE_AFTER_HOURS,
        detail: run?.status ? `Latest sync status: ${run.status}` : "No sync history yet",
      },
    );

    return {
      ...result,
      source: result.source as ElectionsDataSource,
      race,
      candidates,
      ...context,
    };
  } catch (error) {
    return {
      ...emptyResult(
        "unavailable",
        PIPELINE,
        undefined,
        "unavailable",
        error instanceof Error ? error.message : "Stored election read failed",
      ),
      source: "unavailable" as ElectionsDataSource,
      race: undefined,
      candidates: [] as RaceCandidateWithMoney[],
      ...context,
    };
  }
}
