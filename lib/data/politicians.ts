import { cache } from "react";

import { emptyResult, withData } from "@/lib/data/result";
import { listStoredBillsBySponsor } from "@/lib/supabase/bills";
import { listStoredCommitteeMembershipsByPoliticianId } from "@/lib/supabase/committees";
import { getStoredPoliticianBySlug, listStoredPoliticians, listStoredPoliticianStates } from "@/lib/supabase/politicians";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getLatestSyncRun } from "@/lib/supabase/sync";
import { listStoredVotePositionContextByPoliticianId } from "@/lib/supabase/votes";
import { buildUpdatedPoliticianRowsFromVotePositions } from "@/lib/server/vote-stats";
import { resolveSortDirection, sortDirectionFactor } from "@/lib/sort-direction";
import { normalizeDistrictSeat, normalizePersonLookup, normalizeStateCode, normalizeStateLabel, slugifySegment, sortLabelsAlphabetically } from "@/lib/utils";
import type { Bill, Politician } from "@/types/civic";
import type { PoliticianRow } from "@/types/supabase";

export type PoliticianDataSource = "supabase" | "unconfigured" | "unavailable";
export const POLITICIAN_DIRECTORY_PAGE_SIZE = 20;

export interface PoliticiansDirectorySearchParams {
  page?: string;
  q?: string;
  office?: string;
  level?: string;
  party?: string;
  state?: string;
  sort?: string;
  dir?: string;
}

function parsePositiveInt(value?: string, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const FEDERAL_HOUSE_DISTRICT_COUNTS: Record<string, number> = {
  AL: 7, AK: 1, AS: 1, AZ: 9, AR: 4, CA: 52, CO: 8, CT: 5, DC: 1, DE: 1,
  FL: 28, GA: 14, GU: 1, HI: 2, IA: 4, ID: 2, IL: 17, IN: 9, KS: 4, KY: 6,
  LA: 6, MA: 9, MD: 8, ME: 2, MI: 13, MN: 8, MO: 8, MP: 1, MS: 4, MT: 2,
  NC: 14, ND: 1, NE: 3, NH: 2, NJ: 12, NM: 3, NV: 4, NY: 26, OH: 15, OK: 5,
  OR: 6, PA: 17, PR: 1, RI: 2, SC: 7, SD: 1, TN: 9, TX: 38, UT: 4, VA: 11,
  VI: 1, VT: 1, WA: 10, WI: 8, WV: 2, WY: 1,
};

export const FEDERAL_HOUSE_OFFICE_KEYS = Object.entries(FEDERAL_HOUSE_DISTRICT_COUNTS)
  .flatMap(([stateCode, count]) =>
    count === 1
      ? [`${stateCode}-AL`]
      : Array.from({ length: count }, (_, index) => `${stateCode}-${index + 1}`),
  )
  .sort((left, right) => left.localeCompare(right, "en-US", { numeric: true, sensitivity: "base" }));

const FEDERAL_HOUSE_VACANCIES: Record<string, { vacantSince: string; previousRepresentative: string; note: string }> = {
  "CA-14": {
    vacantSince: "2026-04-17",
    previousRepresentative: "Eric Swalwell",
    note: "Vacant pending a special election.",
  },
  "FL-20": {
    vacantSince: "2026-04-21",
    previousRepresentative: "Sheila Cherfilus-McCormick",
    note: "Vacant pending a special election.",
  },
  "GA-13": {
    vacantSince: "2026-04-22",
    previousRepresentative: "David Scott",
    note: "Vacant pending a special election.",
  },
  "TX-23": {
    vacantSince: "2026-04-14",
    previousRepresentative: "Tony Gonzales",
    note: "Vacant pending a special election.",
  },
};

function enhancePoliticianStats(politicians: Politician[], bills: Bill[]) {
  const billsByPolitician = new Map<string, Bill[]>();
  for (const bill of bills) {
    const sponsorKey = bill.sponsorId || slugifySegment(bill.sponsorName);
    const items = billsByPolitician.get(sponsorKey) || [];
    items.push(bill);
    billsByPolitician.set(sponsorKey, items);
  }

  return politicians.map((politician) => {
    const sponsoredBills = billsByPolitician.get(politician.id)
      || billsByPolitician.get(slugifySegment(politician.name))
      || [];

    return {
      ...politician,
      stats: {
        ...politician.stats,
        billsIntroduced: sponsoredBills.length || politician.stats.billsIntroduced,
        billsPassed: sponsoredBills.filter((bill) => bill.status === "Passed Chamber" || bill.status === "Signed").length,
      },
    };
  });
}

async function hydratePoliticianVoteStats(politician: Politician) {
  if (politician.stats.votesWithParty > 0 || politician.stats.votesAgainstParty > 0 || politician.stats.attendance > 0) {
    return politician;
  }

  const positionRows = await listStoredVotePositionContextByPoliticianId(politician.id).catch(() => []);
  if (positionRows.length === 0) {
    return politician;
  }

  const updatedRows = buildUpdatedPoliticianRowsFromVotePositions(
    [{
      id: politician.id,
      slug: politician.slug,
      name: politician.name,
      title: politician.title,
      party: politician.party,
      state: politician.state,
      district: politician.district || null,
      biography: politician.biography,
      born: politician.born,
      education: politician.education,
      occupation: politician.occupation,
      website: politician.website,
      office_phone: politician.officePhone,
      office_address: politician.officeAddress,
      next_election: politician.nextElection,
      stats: politician.stats,
      ideology: politician.ideology,
      source: "derived_read",
      source_system: politician.sourceMetadata?.sourceSystem || "derived_read",
      source_id: politician.sourceMetadata?.sourceId || politician.id,
      jurisdiction_type: politician.jurisdictionType,
      state_code: politician.state,
      session_id: politician.sessionId || null,
      synced_at: politician.sourceMetadata?.syncedAt || new Date().toISOString(),
      raw_member: {},
    } satisfies PoliticianRow],
    positionRows,
  );

  const updated = updatedRows[0];
  return updated
    ? {
        ...politician,
        stats: updated.stats,
      }
    : politician;
}

function getDisplayStateCode(politician: Politician) {
  return normalizeStateCode(politician.state);
}

function getDisplayOfficeBucket(politician: Politician) {
  if (politician.title === "US Senator") return "us-senate";
  if (politician.title === "US Representative") return "us-house";
  return "other";
}

function getDisplayOfficeLabel(politician: Politician) {
  if (politician.jurisdictionType === "federal") {
    if (politician.title === "President") return "US President";
    if (politician.title === "US Senator") return "US Senate";
    if (politician.title === "US Representative") return "US House";
    return "Other federal";
  }

  if (politician.title.includes("Senator")) return "State Senate";
  if (politician.title.includes("Representative")) return "State House";
  return "Other state";
}

function getDisplayDistrictKey(politician: Politician) {
  return normalizeDistrictSeat(politician.state, politician.district);
}

function getDisplayIdentityKey(politician: Politician) {
  const normalizedName = normalizePersonLookup(politician.name);
  const tokens = normalizedName.split(" ").filter(Boolean);
  const simplifiedName = tokens.length >= 3
    ? `${tokens[0]} ${tokens[tokens.length - 1]}`
    : normalizedName;
  return `${getDisplayStateCode(politician)}|${simplifiedName}|${getDisplayOfficeBucket(politician)}`;
}

function hasMeaningfulText(value?: string) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return ![
    "",
    "not available from configured sources",
    "office address not available from configured sources",
    "federal election calendar not connected",
    "state election feed not connected",
  ].includes(normalized);
}

function compareDisplayPoliticians(left: Politician, right: Politician) {
  const leftVoteScore = left.stats.attendance + left.stats.votesWithParty + left.stats.votesAgainstParty;
  const rightVoteScore = right.stats.attendance + right.stats.votesWithParty + right.stats.votesAgainstParty;
  const leftContactScore = [left.website, left.officePhone, left.officeAddress].filter(hasMeaningfulText).length;
  const rightContactScore = [right.website, right.officePhone, right.officeAddress].filter(hasMeaningfulText).length;

  return (
    rightVoteScore - leftVoteScore
    || rightContactScore - leftContactScore
    || right.stats.billsIntroduced - left.stats.billsIntroduced
    || left.name.localeCompare(right.name, "en-US", { sensitivity: "base" })
  );
}

function mergeDisplayPoliticians(group: Politician[]) {
  const sorted = [...group].sort(compareDisplayPoliticians);
  const best = sorted[0];
  const longestName = [...group]
    .map((politician) => politician.name)
    .sort((left, right) => right.length - left.length || left.localeCompare(right, "en-US", { sensitivity: "base" }))[0];

  return {
    ...best,
    name: longestName || best.name,
    state: sorted.find((politician) => hasMeaningfulText(politician.state))?.state || best.state,
    district: sorted.find((politician) => politician.district)?.district || best.district,
    website: sorted.find((politician) => hasMeaningfulText(politician.website))?.website || best.website,
    officePhone: sorted.find((politician) => hasMeaningfulText(politician.officePhone))?.officePhone || best.officePhone,
    officeAddress: sorted.find((politician) => hasMeaningfulText(politician.officeAddress))?.officeAddress || best.officeAddress,
    stats: {
      ...best.stats,
      votesWithParty: Math.max(...group.map((politician) => politician.stats.votesWithParty), 0),
      votesAgainstParty: Math.max(...group.map((politician) => politician.stats.votesAgainstParty), 0),
      attendance: Math.max(...group.map((politician) => politician.stats.attendance), 0),
      billsIntroduced: Math.max(...group.map((politician) => politician.stats.billsIntroduced), 0),
      billsPassed: Math.max(...group.map((politician) => politician.stats.billsPassed), 0),
      amendmentsOffered: Math.max(...group.map((politician) => politician.stats.amendmentsOffered), 0),
    },
  } satisfies Politician;
}

function enforceRenderedOfficeUniqueness(politicians: Politician[]) {
  const byIdentity = new Map<string, Politician[]>();

  politicians.forEach((politician) => {
    const key = getDisplayIdentityKey(politician);
    const items = byIdentity.get(key) || [];
    items.push(politician);
    byIdentity.set(key, items);
  });

  const merged = [...byIdentity.values()].map(mergeDisplayPoliticians);
  const usSenators = merged.filter((politician) => politician.title === "US Senator" && getDisplayStateCode(politician));
  const usRepresentatives = merged.filter((politician) => politician.title === "US Representative");
  const others = merged.filter((politician) => politician.title !== "US Senator" && politician.title !== "US Representative");

  const limitedSenators = [...new Map(
    usSenators
      .sort(compareDisplayPoliticians)
      .map((politician) => [`${getDisplayStateCode(politician)}|${normalizePersonLookup(politician.name)}`, politician] as const),
  ).values()]
    .reduce<Map<string, Politician[]>>((accumulator, politician) => {
      const stateCode = getDisplayStateCode(politician);
      const items = accumulator.get(stateCode) || [];
      items.push(politician);
      accumulator.set(stateCode, items);
      return accumulator;
    }, new Map<string, Politician[]>());

  const senateRows = [...limitedSenators.values()]
    .flatMap((group) => group.sort(compareDisplayPoliticians).slice(0, 2));

  const representativeByDistrict = new Map<string, Politician>();
  usRepresentatives.forEach((politician) => {
    const districtKey = getDisplayDistrictKey(politician);
    if (!districtKey) {
      return;
    }

    const existing = representativeByDistrict.get(districtKey);
    if (!existing || compareDisplayPoliticians(politician, existing) < 0) {
      representativeByDistrict.set(districtKey, politician);
    }
  });

  const representativeRows = FEDERAL_HOUSE_OFFICE_KEYS
    .map((officeKey) => representativeByDistrict.get(officeKey))
    .filter((politician): politician is Politician => Boolean(politician));
  return [...senateRows, ...representativeRows, ...others]
    .sort((left, right) => left.name.localeCompare(right.name, "en-US", { sensitivity: "base" }));
}

function buildVacancyPlaceholder(officeKey: string) {
  const vacancy = FEDERAL_HOUSE_VACANCIES[officeKey];
  if (!vacancy) {
    return undefined;
  }

  const [stateCode, districtSuffix] = officeKey.split("-");
  const state = normalizeStateLabel(stateCode);
  const district = districtSuffix === "AL" ? `${state} at-large seat` : `${state}'s ${districtSuffix} Congressional District`;
  const vacantSinceLabel = new Date(`${vacancy.vacantSince}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  return {
    id: `vacant-${officeKey.toLowerCase()}`,
    slug: `vacant-${officeKey.toLowerCase()}`,
    name: `${district} vacancy`,
    title: "US Representative",
    party: "Vacant",
    state,
    district: officeKey,
    biography: `${district} has been vacant since ${vacantSinceLabel}. Previously represented by ${vacancy.previousRepresentative}. ${vacancy.note}`,
    born: "Seat currently vacant",
    education: "Seat currently vacant",
    occupation: "Vacant office",
    website: "",
    officePhone: "",
    officeAddress: "",
    nextElection: "Special election pending",
    jurisdictionType: "federal",
    stats: {
      votesWithParty: 0,
      votesAgainstParty: 0,
      attendance: 0,
      billsIntroduced: 0,
      billsPassed: 0,
      amendmentsOffered: 0,
    },
    ideology: {},
    sourceMetadata: {
      sourceSystem: "congress_vacancy",
      sourceId: officeKey,
      rawAvailable: false,
    },
  } satisfies Politician;
}

function fillFederalHouseVacancies(politicians: Politician[]) {
  const occupied = new Set(
    politicians
      .filter((politician) => politician.title === "US Representative")
      .map((politician) => politician.district)
      .filter(Boolean),
  );

  const vacancyRows = Object.keys(FEDERAL_HOUSE_VACANCIES)
    .filter((officeKey) => !occupied.has(officeKey))
    .map(buildVacancyPlaceholder)
    .filter(Boolean) as Politician[];

  return [...politicians, ...vacancyRows];
}

export async function getPoliticiansData() {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "federal_members_sync", [] as Politician[], "unconfigured"),
      politicians: [] as Politician[],
    };
  }

  try {
    const [politicians, federalMembersRun, federalLegislationRun, stateRun] = await Promise.all([
      listStoredPoliticians(),
      getLatestSyncRun("federal_members_sync").catch(() => undefined),
      getLatestSyncRun("federal_legislation_sync").catch(() => undefined),
      getLatestSyncRun("state_legislation_sync").catch(() => undefined),
    ]);
    const enrichedPoliticians = fillFederalHouseVacancies(
      enforceRenderedOfficeUniqueness(politicians),
    );
    const latestRun = [federalMembersRun, federalLegislationRun, stateRun]
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))[0];
    const result = withData(
      enrichedPoliticians.length > 0 ? "supabase" : "unavailable",
      "federal_members_sync",
      enrichedPoliticians,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: enrichedPoliticians.length > 0 ? "live" : "empty",
        detail: latestRun?.status ? `Latest sync status: ${latestRun.status}` : "No sync history yet",
      },
    );
    return { ...result, source: result.source as PoliticianDataSource, politicians: enrichedPoliticians };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "federal_members_sync", [] as Politician[], "unavailable", error instanceof Error ? error.message : "Stored politician read failed"),
      politicians: [] as Politician[],
    };
  }
}

export const POLITICIAN_SORT_OPTIONS = ["Name", "Attendance", "Bills introduced", "Party alignment", "Recent activity"];
const FEDERAL_CHAMBERS = ["All chambers", "US House", "US Senate", "US President"];
const STATE_CHAMBERS = ["All chambers", "State House", "State Senate"];
export const SELECT_A_STATE = "Select a state";

function emptyDirectoryOptions() {
  return {
    offices: FEDERAL_CHAMBERS,
    levels: ["Federal", "State"],
    parties: ["All parties"],
    states: [SELECT_A_STATE],
    sortOptions: POLITICIAN_SORT_OPTIONS,
  };
}

export async function getPoliticiansDirectoryData(searchParams: PoliticiansDirectorySearchParams) {
  const page = parsePositiveInt(searchParams.page, 1);

  // Level is the primary filter and defaults to Federal, so the directory opens on one bounded
  // set instead of every member of every legislature. State requires an explicit state before
  // anything is read.
  const level = searchParams.level === "State" ? "State" : "Federal";
  const isState = level === "State";
  const selectedState = (searchParams.state || "").trim().toUpperCase();
  const sortBy = searchParams.sort || "Name";
  const filters = {
    query: (searchParams.q || "").trim(),
    office: searchParams.office || "All chambers",
    level,
    party: searchParams.party || "All parties",
    state: isState && selectedState ? selectedState : SELECT_A_STATE,
    sortBy,
    direction: resolveSortDirection(sortBy, searchParams.dir),
  };

  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "federal_members_sync", [] as Politician[], "unconfigured"),
      politicians: [] as Politician[],
      total: 0,
      page: 1,
      pageSize: POLITICIAN_DIRECTORY_PAGE_SIZE,
      needsState: false,
      filters,
      options: emptyDirectoryOptions(),
    };
  }

  // "State" with no state chosen yet: prompt rather than downloading every state legislator.
  if (isState && !selectedState) {
    const states = await listStoredPoliticianStates().catch(() => [] as string[]);
    return {
      ...emptyResult("supabase", "state_legislation_sync", [] as Politician[], "empty"),
      source: "supabase" as PoliticianDataSource,
      politicians: [] as Politician[],
      total: 0,
      page: 1,
      pageSize: POLITICIAN_DIRECTORY_PAGE_SIZE,
      needsState: true,
      filters,
      options: {
        offices: STATE_CHAMBERS,
        levels: ["Federal", "State"],
        parties: ["All parties"],
        states: [SELECT_A_STATE, ...states],
        sortOptions: POLITICIAN_SORT_OPTIONS,
      },
    };
  }

  try {
    const [politicians, availableStates, federalMembersRun, federalLegislationRun, stateRun] = await Promise.all([
      // Only the level (and, for state, the single state) the user is actually looking at.
      listStoredPoliticians(
        isState
          ? { jurisdictionType: "state", stateCode: selectedState }
          : { jurisdictionType: "federal" },
      ),
      isState ? listStoredPoliticianStates().catch(() => [] as string[]) : Promise.resolve([] as string[]),
      getLatestSyncRun("federal_members_sync").catch(() => undefined),
      getLatestSyncRun("federal_legislation_sync").catch(() => undefined),
      getLatestSyncRun("state_legislation_sync").catch(() => undefined),
    ]);

    // Vacant-seat placeholders only make sense for the federal House.
    const enrichedPoliticians = isState
      ? enforceRenderedOfficeUniqueness(politicians)
      : fillFederalHouseVacancies(enforceRenderedOfficeUniqueness(politicians));

    // Level and state are already applied by the query above; only the secondary filters
    // (chamber, party, search) are left to apply here.
    const filtered = enrichedPoliticians
      .filter((politician) => {
        const normalizedQuery = filters.query.toLowerCase();
        const matchesQuery =
          normalizedQuery.length === 0
          || [
            politician.name,
            politician.title,
            politician.party,
            politician.state,
          ].some((value) => value.toLowerCase().includes(normalizedQuery));

        const office = getDisplayOfficeLabel(politician);

        return matchesQuery
          && (filters.office === "All chambers" || office === filters.office)
          && (filters.party === "All parties" || politician.party === filters.party);
      })
      // Comparators stay in each option's natural order (best first for stats, A-Z for names);
      // the factor reverses them when the reader has flipped the direction.
      .sort((left, right) => {
        const factor = sortDirectionFactor(filters.sortBy, filters.direction);
        if (filters.sortBy === "Attendance") return factor * (right.stats.attendance - left.stats.attendance);
        if (filters.sortBy === "Bills introduced") return factor * (right.stats.billsIntroduced - left.stats.billsIntroduced);
        if (filters.sortBy === "Party alignment") return factor * (right.stats.votesWithParty - left.stats.votesWithParty);
        if (filters.sortBy === "Recent activity") return factor * (right.stats.amendmentsOffered - left.stats.amendmentsOffered);
        return factor * left.name.localeCompare(right.name, "en-US", { sensitivity: "base" });
      });

    const total = filtered.length;
    const pageCount = Math.max(1, Math.ceil(total / POLITICIAN_DIRECTORY_PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = filtered.slice((safePage - 1) * POLITICIAN_DIRECTORY_PAGE_SIZE, safePage * POLITICIAN_DIRECTORY_PAGE_SIZE);

    const presentOffices = new Set(enrichedPoliticians.map(getDisplayOfficeLabel));
    const options = {
      // Chambers are scoped to the level: a federal view never offers "State Senate".
      offices: [
        "All chambers",
        ...(isState ? ["State House", "State Senate"] : ["US House", "US Senate"]),
        // Only offered once a President row actually exists -- there's no sync source for the
        // office yet (see lib/utils.ts normalizeOfficeTitle), so this stays empty until seeded.
        ...(presentOffices.has("US President") && !isState ? ["US President"] : []),
        ...(presentOffices.has("Other state") && isState ? ["Other state"] : []),
        ...(presentOffices.has("Other federal") && !isState ? ["Other federal"] : []),
      ],
      levels: ["Federal", "State"],
      parties: ["All parties", ...sortLabelsAlphabetically(enrichedPoliticians.map((politician) => politician.party))],
      states: isState ? [SELECT_A_STATE, ...availableStates] : [],
      sortOptions: POLITICIAN_SORT_OPTIONS,
    };

    const latestRun = [federalMembersRun, federalLegislationRun, stateRun]
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))[0];
    const result = withData(
      total > 0 ? "supabase" : "unavailable",
      "federal_members_sync",
      pageRows,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: total > 0 ? "live" : "empty",
        detail: latestRun?.status ? `Latest sync status: ${latestRun.status}` : "No sync history yet",
      },
    );

    return {
      ...result,
      source: result.source as PoliticianDataSource,
      politicians: pageRows,
      total,
      page: safePage,
      pageSize: POLITICIAN_DIRECTORY_PAGE_SIZE,
      needsState: false,
      filters,
      options,
    };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "federal_members_sync", [] as Politician[], "unavailable", error instanceof Error ? error.message : "Stored politician read failed"),
      politicians: [] as Politician[],
      total: 0,
      page,
      pageSize: POLITICIAN_DIRECTORY_PAGE_SIZE,
      needsState: false,
      filters,
      options: {
        offices: ["All chambers"],
        levels: ["Federal", "State"],
        parties: ["All parties"],
        states: [SELECT_A_STATE],
        sortOptions: POLITICIAN_SORT_OPTIONS,
      },
    };
  }
}

/**
 * Memoized per render pass: the politician profile page resolves the same slug three times
 * (once directly, then again inside getSponsoredBillsForPolitician and
 * getCommitteeMembershipsForPolitician), and each call was a fresh slug lookup plus two
 * sync-run reads plus vote-stat hydration.
 */
export const getPoliticianData = cache(async (slug: string) => {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "federal_members_sync", undefined, "unconfigured"),
      politician: undefined,
    };
  }

  try {
    const [politician, federalMembersRun, federalLegislationRun] = await Promise.all([
      getStoredPoliticianBySlug(slug),
      getLatestSyncRun("federal_members_sync").catch(() => undefined),
      getLatestSyncRun("federal_legislation_sync").catch(() => undefined),
    ]);
    const hydratedPolitician = politician
      ? await hydratePoliticianVoteStats(politician)
      : undefined;
    const latestRun = [federalMembersRun, federalLegislationRun]
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))[0];
    const result = withData(
      hydratedPolitician ? "supabase" : "unavailable",
      "federal_members_sync",
      hydratedPolitician,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: hydratedPolitician ? "live" : "empty",
        detail: latestRun?.status ? `Latest sync status: ${latestRun.status}` : "No sync history yet",
      },
    );
    return { ...result, source: result.source as PoliticianDataSource, politician: hydratedPolitician };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "federal_members_sync", undefined, "unavailable", error instanceof Error ? error.message : "Stored politician read failed"),
      politician: undefined,
    };
  }
});

export async function getPoliticianRouteParams() {
  const { politicians } = await getPoliticiansData();
  return politicians.map((politician) => ({ slug: politician.slug }));
}

export async function getSponsoredBillsForPolitician(slug: string) {
  const { politician } = await getPoliticianData(slug);

  if (!politician) return [];

  const bills = await listStoredBillsBySponsor(politician.id, politician.slug, politician.name).catch(() => []);
  const normalizedPoliticianName = normalizePersonLookup(politician.name);
  return bills.filter((bill) =>
    bill.sponsorId === politician.id
    || slugifySegment(bill.sponsorName) === politician.slug
    || normalizePersonLookup(bill.sponsorName) === normalizedPoliticianName,
  );
}

export async function getCommitteeMembershipsForPolitician(slug: string) {
  const { politician } = await getPoliticianData(slug);
  if (!politician) return [];
  return listStoredCommitteeMembershipsByPoliticianId(politician.id).catch(() => []);
}

export function getPoliticianSourceLabel(source: string) {
  if (source === "supabase") return "Stored Supabase politicians";
  if (source === "unconfigured") return "Supabase is not configured";
  return "Stored politician data unavailable";
}

export function isLivePoliticianSource(source: string) {
  return source === "supabase";
}

export function getPoliticianAnalyticsSeries(
  politician: Politician,
  sponsoredBills: Bill[],
) {
  const sponsorshipBase = Math.max(sponsoredBills.length, 1);

  return {
    alignmentSeries: [
      { label: "2020", value: Math.max(politician.stats.votesWithParty - 4, 0) },
      { label: "2021", value: Math.max(politician.stats.votesWithParty - 2, 0) },
      { label: "2022", value: politician.stats.votesWithParty },
      { label: "2023", value: Math.min(politician.stats.votesWithParty + 1, 100) },
      { label: "2024", value: Math.min(politician.stats.votesWithParty + 2, 100) },
    ],
    distribution: [
      { label: "With party", value: politician.stats.votesWithParty || 0 },
      {
        label: "Cross-party",
        value: politician.stats.votesAgainstParty || 0,
      },
    ],
    bipartisanIndex: Math.min(
      100,
      25 + sponsorshipBase * 6 + Math.floor((politician.stats.votesAgainstParty || 0) / 2),
    ),
    missedVotes: Math.max(0, 100 - politician.stats.attendance) * 8,
    leadershipVotes: sponsoredBills.length * 14,
    swingVotes: sponsoredBills.length * 9,
    consecutiveVotes: Math.max(100, politician.stats.attendance * 11),
  };
}
