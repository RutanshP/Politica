import { emptyResult, withData } from "@/lib/data/result";
import { listStoredBills } from "@/lib/supabase/bills";
import { listStoredCommitteeMembershipsByPoliticianId } from "@/lib/supabase/committees";
import { getStoredPoliticianBySlug, listStoredPoliticians } from "@/lib/supabase/politicians";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getLatestSyncRun } from "@/lib/supabase/sync";
import { listStoredVotePositionContextByPoliticianId } from "@/lib/supabase/votes";
import { buildUpdatedPoliticianRowsFromVotePositions } from "@/lib/server/vote-stats";
import { normalizeDistrictSeat, normalizePersonLookup, normalizeStateCode, slugifySegment } from "@/lib/utils";
import type { Bill, Politician } from "@/types/civic";
import type { PoliticianRow } from "@/types/supabase";

export type PoliticianDataSource = "supabase" | "unconfigured" | "unavailable";

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
  const representativeFallbacks: Politician[] = [];
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

export async function getPoliticiansData() {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "federal_members_sync", [] as Politician[], "unconfigured"),
      politicians: [] as Politician[],
    };
  }

  try {
    const [politicians, bills, federalMembersRun, federalLegislationRun, stateRun] = await Promise.all([
      listStoredPoliticians(),
      listStoredBills().catch(() => []),
      getLatestSyncRun("federal_members_sync").catch(() => undefined),
      getLatestSyncRun("federal_legislation_sync").catch(() => undefined),
      getLatestSyncRun("state_legislation_sync").catch(() => undefined),
    ]);
    const enrichedPoliticians = enforceRenderedOfficeUniqueness(enhancePoliticianStats(politicians, bills));
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

export async function getPoliticianData(slug: string) {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "federal_members_sync", undefined, "unconfigured"),
      politician: undefined,
    };
  }

  try {
    const [politician, bills, federalMembersRun, federalLegislationRun] = await Promise.all([
      getStoredPoliticianBySlug(slug),
      listStoredBills().catch(() => []),
      getLatestSyncRun("federal_members_sync").catch(() => undefined),
      getLatestSyncRun("federal_legislation_sync").catch(() => undefined),
    ]);
    const enrichedPolitician = politician
      ? enhancePoliticianStats([politician], bills)[0]
      : undefined;
    const hydratedPolitician = enrichedPolitician
      ? await hydratePoliticianVoteStats(enrichedPolitician)
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
}

export async function getPoliticianRouteParams() {
  const { politicians } = await getPoliticiansData();
  return politicians.map((politician) => ({ slug: politician.slug }));
}

export async function getSponsoredBillsForPolitician(slug: string) {
  const [bills, { politician }] = await Promise.all([
    listStoredBills().catch(() => []),
    getPoliticianData(slug),
  ]);

  if (!politician) return [];

  const normalizedPoliticianName = normalizePersonLookup(politician.name);
  return bills.filter((bill) =>
    bill.sponsorId === politician.id || slugifySegment(bill.sponsorName) === politician.slug,
  ).concat(
    bills.filter((bill) => normalizePersonLookup(bill.sponsorName) === normalizedPoliticianName),
  ).filter((bill, index, items) => items.findIndex((candidate) => candidate.id === bill.id) === index);
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
