import { fetchOpenStatesExecutives, isOpenStatesConfigured } from "@/lib/adapters/openstates";
import {
  currentExecutives,
  displayName,
  fetchExecutiveRecords,
  type ExecutiveRecord,
  type ExecutiveTerm,
} from "@/lib/adapters/executive";
import { upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";
import { normalizeStateCode, normalizeStateLabel, slugifySegment } from "@/lib/utils";
import type { PoliticianRow } from "@/types/supabase";

/**
 * Syncs the executive branch: President and Vice President federally, governors by state.
 *
 * Stored in `politicians` with branch='executive' rather than in a table of their own. They are
 * people who hold office, carry a party and a term, and belong in search and the directory
 * alongside everyone else -- a parallel table would have meant duplicating all of that. The branch
 * column is what keeps them out of lists of Congress.
 */

const EMPTY_STATS = {
  votesWithParty: 0,
  votesAgainstParty: 0,
  attendance: 0,
  billsIntroduced: 0,
  billsPassed: 0,
  amendmentsOffered: 0,
  totalVotes: 0,
  castVotes: 0,
  withPartyCount: 0,
  againstPartyCount: 0,
};

/** Shared shape for an executive row, so the two very different sources land identically. */
function buildExecutiveRow(input: {
  id: string;
  name: string;
  title: string;
  party: string;
  state: string;
  jurisdictionType: "federal" | "state";
  /**
   * Two-letter code, or null for the two national offices.
   *
   * Must be the code, not the label. The state directory filters `state_code=eq.TX`, so storing
   * "Texas" here made every governor unreachable through the UI -- they were in the table and
   * matched nothing. mapPoliticianToRow uses normalizeStateCode for exactly this reason; this
   * reached for normalizeStateLabel and got a display string.
   */
  stateCode: string | null;
  biography: string;
  website: string;
  sourceSystem: string;
  sourceId: string;
  nextElection: string;
  raw: unknown;
}): PoliticianRow {
  const now = new Date().toISOString();

  return {
    id: input.id,
    slug: slugifySegment(input.name),
    name: input.name,
    title: input.title,
    party: input.party,
    state: input.state,
    district: null,
    biography: input.biography,
    born: "Not stated",
    education: "Not stated",
    occupation: input.title,
    website: input.website,
    office_phone: "Not stated",
    office_address: "Not stated",
    next_election: input.nextElection,
    // Vote and sponsorship counters describe a legislator. An executive has neither, and leaving
    // them at zero is honest -- the UI already hides the panel when a member has no vote history.
    stats: EMPTY_STATS,
    ideology: {},
    source: "executive_sync",
    source_system: input.sourceSystem,
    source_id: input.sourceId,
    jurisdiction_type: input.jurisdictionType,
    state_code: input.stateCode,
    session_id: null,
    branch: "executive",
    source_updated_at: null,
    source_fingerprint: null,
    last_profile_synced_at: now,
    last_stats_recomputed_at: null,
    synced_at: now,
    raw_payload: null,
    raw_member: input.raw,
  };
}

/**
 * President and Vice President.
 *
 * Ids are namespaced `exec-` rather than reusing the bioguide. J.D. Vance holds a bioguide from
 * the Senate and may already be a row in this table; writing the vice presidency under that same
 * id would overwrite his legislative record and its vote history.
 */
export function buildFederalExecutiveRows(records: ExecutiveRecord[], today?: string): PoliticianRow[] {
  return currentExecutives(records, today).map(({ record, term, office }) => {
    const name = displayName(record);
    const bioguide = record.id?.bioguide;

    return buildExecutiveRow({
      id: `exec-${bioguide || slugifySegment(name)}`,
      name,
      title: office,
      party: term.party || "Unknown",
      state: "United States",
      // National office: no state, so nothing should match a state filter.
      stateCode: null,
      jurisdictionType: "federal",
      biography: `${office} of the United States since ${term.start || "an unrecorded date"}.`,
      website: office === "President" ? "https://www.whitehouse.gov" : "https://www.whitehouse.gov",
      sourceSystem: "congress_legislators",
      sourceId: bioguide || slugifySegment(name),
      nextElection: term.end ? term.end.slice(0, 4) : "Not stated",
      raw: record,
    });
  });
}

interface OpenStatesExecutive {
  id?: string;
  name?: string;
  party?: string;
  current_role?: { title?: string; org_classification?: string };
  links?: Array<{ url?: string }>;
  openstates_url?: string;
}

/** Only the governor; the same query also returns lieutenant governors, AGs and secretaries of state. */
function isGovernor(person: OpenStatesExecutive) {
  return /^governor$/i.test((person.current_role?.title || "").replace(/_/g, " ").trim());
}

export function buildGovernorRows(state: string, people: OpenStatesExecutive[]): PoliticianRow[] {
  const stateLabel = normalizeStateLabel(state) || state.toUpperCase();

  return people.filter(isGovernor).map((person) => {
    const name = (person.name || "Unknown").trim();

    return buildExecutiveRow({
      // Namespaced by state, so re-running cannot create a second row for the same office and a
      // new governor replaces the old one rather than accumulating.
      id: `gov-${state.toLowerCase()}`,
      name,
      title: "Governor",
      party: person.party || "Unknown",
      state: stateLabel,
      stateCode: normalizeStateCode(stateLabel) || state.toUpperCase(),
      jurisdictionType: "state",
      biography: `Governor of ${stateLabel}.`,
      website: person.links?.[0]?.url || person.openstates_url || "Not stated",
      sourceSystem: "openstates",
      sourceId: person.id || `gov-${state}`,
      nextElection: "Not stated",
      raw: person,
    });
  });
}

export interface ExecutiveSyncResult {
  presidentsSynced: number;
  governorsSynced: number;
  statesScanned: number;
  /** Queried successfully, but the source lists no governor -- a real gap in OpenStates. */
  statesWithoutGovernor: string[];
  /** The request itself failed. Retryable, and not evidence of anything about the state. */
  statesFailed: Array<{ state: string; reason: string }>;
  at: string;
}

export async function syncExecutiveBranch(options?: {
  /** Which states to look for governors in. OpenStates rate-limits hard, so callers chunk this. */
  states?: string[];
  includeFederal?: boolean;
  dryRun?: boolean;
}): Promise<ExecutiveSyncResult> {
  const rows: PoliticianRow[] = [];
  let presidentsSynced = 0;

  if (options?.includeFederal !== false) {
    const records = await fetchExecutiveRecords();
    const federal = buildFederalExecutiveRows(records);
    rows.push(...federal);
    presidentsSynced = federal.length;
  }

  const states = options?.states ?? [];
  const statesWithoutGovernor: string[] = [];
  const statesFailed: ExecutiveSyncResult["statesFailed"] = [];
  let governorsSynced = 0;

  if (states.length > 0 && isOpenStatesConfigured()) {
    for (const state of states) {
      /*
       * A failed request and a state with no governor are different facts and must not be reported
       * as one. Swallowing the error made NH, NJ and UT -- which returned 502/504 -- look identical
       * to California, which genuinely lists only a lieutenant governor, attorney general and
       * secretary of state. One is retryable; the other is the source's own gap.
       */
      let people: OpenStatesExecutive[];
      try {
        people = (await fetchOpenStatesExecutives(state)) as OpenStatesExecutive[];
      } catch (error) {
        statesFailed.push({
          state,
          reason: (error instanceof Error ? error.message : String(error)).slice(0, 160),
        });
        continue;
      }

      const governors = buildGovernorRows(state, people);
      if (governors.length === 0) {
        statesWithoutGovernor.push(state);
        continue;
      }

      rows.push(...governors);
      governorsSynced += governors.length;
    }
  }

  if (!options?.dryRun && rows.length > 0) {
    await upsertSupabaseRowsInChunks("politicians", rows, "id", 25);
  }

  return {
    presidentsSynced,
    governorsSynced,
    statesScanned: states.length,
    statesWithoutGovernor,
    statesFailed,
    at: new Date().toISOString(),
  };
}
