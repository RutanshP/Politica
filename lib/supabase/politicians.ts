import { cache } from "react";

import { POLITICIANS_CACHE_TAG } from "@/lib/supabase/cache-tags";
import type { Politician } from "@/types/civic";
import type { PoliticianRow } from "@/types/supabase";
import { fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";
import { normalizeDistrictSeat, normalizeOfficeTitle, normalizePartyLabel, normalizePersonLookup, normalizeStateCode, normalizeStateLabel } from "@/lib/utils";

type RawCongressTerm = {
  chamber?: string;
  district?: string | number;
  memberType?: string | number;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function fallbackPoliticianName(row: PoliticianRow) {
  if (row.name?.trim()) {
    return row.name.trim();
  }

  const rawMember = (row.raw_member ?? row.raw_payload ?? {}) as Record<string, unknown>;
  const directName = normalizeWhitespace([
    typeof rawMember.honorificName === "string" ? rawMember.honorificName : "",
    typeof rawMember.firstName === "string" ? rawMember.firstName : "",
    typeof rawMember.lastName === "string" ? rawMember.lastName : "",
  ].filter(Boolean).join(" "));

  if (directName) {
    return directName;
  }

  if (typeof rawMember.name === "string" && rawMember.name.trim()) {
    return rawMember.name.trim();
  }

  if (typeof rawMember.invertedOrderName === "string" && rawMember.invertedOrderName.trim()) {
    const rebuilt = normalizeWhitespace(
      rawMember.invertedOrderName
        .split(",")
        .reverse()
        .join(" "),
    ).replace(/^,+|,+$/g, "").trim();

    if (rebuilt) {
      return rebuilt;
    }
  }

  return row.title?.trim() || row.id;
}

function getRawMemberRecord(row: PoliticianRow) {
  return (row.raw_member ?? row.raw_payload ?? {}) as Record<string, unknown>;
}

function getRawCongressTerms(row: PoliticianRow) {
  const rawMember = getRawMemberRecord(row);
  const rawTerms = rawMember.terms;

  if (Array.isArray(rawTerms)) {
    return rawTerms.filter(Boolean) as RawCongressTerm[];
  }

  if (rawTerms && typeof rawTerms === "object" && "item" in rawTerms) {
    const item = (rawTerms as { item?: RawCongressTerm[] | RawCongressTerm }).item;
    if (Array.isArray(item)) {
      return item.filter(Boolean);
    }
    if (item) {
      return [item];
    }
  }

  return [] as RawCongressTerm[];
}

function inferAtLargeDistrict(row: PoliticianRow, term?: RawCongressTerm) {
  const chamber = String(term?.chamber || "").toLowerCase();
  const memberType = String(term?.memberType || "").toLowerCase();
  if (
    chamber.includes("house")
    || memberType.includes("representative")
    || memberType.includes("delegate")
    || memberType.includes("resident commissioner")
  ) {
    return normalizeDistrictSeat(row.state_code || row.state, "AL") || null;
  }

  return null;
}

function readRawCongressDistrict(row: PoliticianRow) {
  const rawMember = getRawMemberRecord(row);
  const directDistrict = typeof rawMember.district === "string" || typeof rawMember.district === "number"
    ? rawMember.district
    : undefined;
  const terms = getRawCongressTerms(row);
  const latestTerm = terms.at(-1);
  const latestTermDistrict = typeof latestTerm?.district === "string" || typeof latestTerm?.district === "number"
    ? latestTerm.district
    : undefined;
  const candidate = directDistrict ?? latestTermDistrict;

  if (candidate === undefined || candidate === null || candidate === "") {
    return inferAtLargeDistrict(row, latestTerm);
  }

  return normalizeDistrictSeat(row.state_code || row.state, candidate)
    || inferAtLargeDistrict(row, latestTerm);
}

function getResolvedDistrict(row: PoliticianRow) {
  const storedDistrict = (row.district || "").trim();
  if (storedDistrict) {
    return normalizeDistrictSeat(row.state_code || row.state, storedDistrict) || storedDistrict;
  }

  if (row.jurisdiction_type !== "federal") {
    return row.district;
  }

  return readRawCongressDistrict(row);
}

function isPlaceholderText(value?: string | null) {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    "not available from configured sources",
    "office address not available from configured sources",
    "federal election calendar not connected",
    "state election feed not connected",
    "placeholder federal legislator record created from official roll-call vote data.",
    "placeholder state legislator record created from openstates sponsorship data.",
    "public official",
    "www.congress.gov/member",
    "unknown",
  ].includes(normalized);
}

function getVoteStatScore(row: PoliticianRow) {
  return (row.stats.attendance || 0) + (row.stats.votesWithParty || 0) + (row.stats.votesAgainstParty || 0);
}

function hasFederalDistrict(row: PoliticianRow) {
  return Boolean(normalizeDistrictSeat(row.state_code || row.state, getResolvedDistrict(row)));
}

function inferFederalVoteTitle(row: PoliticianRow) {
  const hint = `${row.source_id || ""} ${row.id || ""}`.toLowerCase();
  if (hint.includes("senatelis") || hint.includes("senate")) {
    return "US Senator";
  }
  if (hint.includes("houseclerk") || hint.includes("house")) {
    return "US Representative";
  }
  return "US Legislator";
}

function getResolvedOfficeTitle(row: PoliticianRow) {
  const normalized = normalizeOfficeTitle(row.title, {
    jurisdictionType: row.jurisdiction_type,
    state: row.state_code || row.state,
  });

  if (row.jurisdiction_type === "federal" && normalized === "US Representative" && !hasFederalDistrict(row)) {
    return "US Legislator";
  }

  if (row.jurisdiction_type === "federal" && row.source_system === "federal_votes") {
    if (normalized === "US Legislator") {
      const inferred = inferFederalVoteTitle(row);
      if (inferred === "US Representative" && !hasFederalDistrict(row)) {
        return "US Legislator";
      }
      return inferred;
    }
  }

  return normalized;
}

function getTitleScore(row: PoliticianRow) {
  const title = getResolvedOfficeTitle(row);

  if (title.includes("Representative") || title.includes("Senator")) {
    return 3;
  }
  if (title.includes("Legislator")) {
    return 1;
  }
  return 2;
}

function getSourceScore(row: PoliticianRow) {
  if (row.source_system === "congress" || row.source_system === "openstates") {
    return 3;
  }
  if (row.source_system === "federal_votes") {
    return 1;
  }
  return 2;
}

function getContactScore(row: PoliticianRow) {
  const values = [row.website, row.office_phone, row.office_address];
  return values.filter((value) => !isPlaceholderText(value)).length;
}

function comparePoliticianQuality(left: PoliticianRow, right: PoliticianRow) {
  return (
    getTitleScore(right) - getTitleScore(left)
    || getSourceScore(right) - getSourceScore(left)
    || getContactScore(right) - getContactScore(left)
    || getVoteStatScore(right) - getVoteStatScore(left)
    || (right.stats.billsIntroduced || 0) - (left.stats.billsIntroduced || 0)
  );
}

function comparePoliticianQualityDesc(left: PoliticianRow, right: PoliticianRow) {
  return comparePoliticianQuality(left, right)
    || fallbackPoliticianName(left).localeCompare(fallbackPoliticianName(right), "en-US", { sensitivity: "base" });
}

function getOfficeFamily(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("senator")) return "senate";
  if (lower.includes("representative")) return "house";
  if (lower.includes("legislator")) return "generic";
  return lower;
}

function getSimplifiedIdentityName(row: PoliticianRow) {
  const normalizedName = normalizePersonLookup(fallbackPoliticianName(row));
  const tokens = normalizedName.split(" ").filter(Boolean);
  if (tokens.length >= 3) {
    return `${tokens[0]} ${tokens[tokens.length - 1]}`;
  }
  return normalizedName;
}

function getPoliticianIdentityKey(row: PoliticianRow) {
  const normalizedName = getSimplifiedIdentityName(row);
  const state = normalizeStateCode(row.state_code || row.state) || (row.state_code || row.state || "").trim().toUpperCase();
  const jurisdiction = row.jurisdiction_type || "unknown";
  return `${jurisdiction}|${state}|${normalizedName}`;
}

function getStateCode(row: PoliticianRow) {
  return normalizeStateCode(row.state_code || row.state) || (row.state_code || row.state || "").trim().toUpperCase();
}

function getOfficeFamilyForRow(row: PoliticianRow) {
  return getOfficeFamily(getResolvedOfficeTitle(row));
}

function getDistrictKey(row: PoliticianRow) {
  return normalizeDistrictSeat(row.state_code || row.state, getResolvedDistrict(row));
}

function getPoliticianDedupKey(row: PoliticianRow) {
  const officeFamily = getOfficeFamily(getResolvedOfficeTitle(row));
  return `${getPoliticianIdentityKey(row)}|${officeFamily}`;
}

function firstMeaningful<T extends string | null | undefined>(values: T[]) {
  return values.find((value) => !isPlaceholderText(value)) ?? values.find((value) => Boolean(value?.trim())) ?? null;
}

function chooseDisplayName(rows: PoliticianRow[]) {
  return rows
    .map((row) => fallbackPoliticianName(row))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length || left.localeCompare(right, "en-US", { sensitivity: "base" }))[0];
}

function mergePoliticianStats(rows: PoliticianRow[]) {
  return {
    votesWithParty: Math.max(...rows.map((row) => row.stats.votesWithParty || 0), 0),
    votesAgainstParty: Math.max(...rows.map((row) => row.stats.votesAgainstParty || 0), 0),
    attendance: Math.max(...rows.map((row) => row.stats.attendance || 0), 0),
    billsIntroduced: Math.max(...rows.map((row) => row.stats.billsIntroduced || 0), 0),
    billsPassed: Math.max(...rows.map((row) => row.stats.billsPassed || 0), 0),
    amendmentsOffered: Math.max(...rows.map((row) => row.stats.amendmentsOffered || 0), 0),
  };
}

function mergePoliticianRowGroup(rows: PoliticianRow[]) {
  const specificRows = rows.filter((row) => getOfficeFamilyForRow(row) !== "generic");
  const votefulSpecificRows = specificRows.filter((row) => getVoteStatScore(row) > 0);
  const votefulRows = rows.filter((row) => getVoteStatScore(row) > 0);
  const candidateRows = votefulSpecificRows.length > 0
    ? votefulSpecificRows
    : specificRows.length > 0
      ? specificRows
      : votefulRows.length > 0
        ? votefulRows
        : rows;
  const sorted = [...candidateRows].sort(comparePoliticianQuality);
  const best = sorted[0];
  const allRows = [...rows].sort(comparePoliticianQuality);

  return {
    ...best,
    name: chooseDisplayName(allRows) || fallbackPoliticianName(best),
    title: getResolvedOfficeTitle(best),
    party: firstMeaningful(allRows.map((row) => row.party)) || best.party,
    state: firstMeaningful(allRows.map((row) => row.state)) || best.state,
    district: firstMeaningful(allRows.map((row) => getResolvedDistrict(row))) || null,
    biography: firstMeaningful(allRows.map((row) => row.biography)) || best.biography,
    born: firstMeaningful(allRows.map((row) => row.born)) || best.born,
    education: firstMeaningful(allRows.map((row) => row.education)) || best.education,
    occupation: firstMeaningful(allRows.map((row) => row.occupation)) || best.occupation,
    website: firstMeaningful(allRows.map((row) => row.website)) || best.website,
    office_phone: firstMeaningful(allRows.map((row) => row.office_phone)) || best.office_phone,
    office_address: firstMeaningful(allRows.map((row) => row.office_address)) || best.office_address,
    next_election: firstMeaningful(allRows.map((row) => row.next_election)) || best.next_election,
    state_code: firstMeaningful(allRows.map((row) => row.state_code)) || best.state_code,
    raw_payload: best.raw_payload ?? allRows.find((row) => row.raw_payload)?.raw_payload ?? null,
    raw_member: best.raw_member ?? allRows.find((row) => row.raw_member)?.raw_member ?? null,
    stats: mergePoliticianStats(allRows),
  } satisfies PoliticianRow;
}

function mergeDuplicatePoliticianRows(rows: PoliticianRow[]) {
  const identityGroups = new Map<string, PoliticianRow[]>();

  rows.forEach((row) => {
    const key = getPoliticianIdentityKey(row);
    const items = identityGroups.get(key) || [];
    items.push(row);
    identityGroups.set(key, items);
  });

  return [...identityGroups.values()]
    .flatMap((identityGroup) => {
      const officeGroups = new Map<string, PoliticianRow[]>();

      identityGroup.forEach((row) => {
        const key = getPoliticianDedupKey(row);
        const items = officeGroups.get(key) || [];
        items.push(row);
        officeGroups.set(key, items);
      });

      const genericRows = [...officeGroups.entries()]
        .filter(([key]) => key.endsWith("|generic"))
        .flatMap(([, group]) => group);
      const specificGroups = [...officeGroups.entries()]
        .filter(([key]) => !key.endsWith("|generic"))
        .map(([, group]) => group);

      if (specificGroups.length <= 1) {
        return [mergePoliticianRowGroup([...genericRows, ...specificGroups.flat()])];
      }

      if (genericRows.length === 0) {
        const bestStatsGroupIndex = specificGroups
          .map((group, index) => ({
            index,
            stats: Math.max(...group.map(getVoteStatScore), 0),
            quality: comparePoliticianQuality(group[0], [...group].sort(comparePoliticianQuality)[0]),
          }))
          .sort((left, right) => right.stats - left.stats)[0]?.index ?? 0;
        const zeroStatGroupCount = specificGroups.filter((group) => Math.max(...group.map(getVoteStatScore), 0) === 0).length;
        const positiveStatGroupCount = specificGroups.filter((group) => Math.max(...group.map(getVoteStatScore), 0) > 0).length;

        if (positiveStatGroupCount === 1 && zeroStatGroupCount === specificGroups.length - 1) {
          return [mergePoliticianRowGroup(specificGroups.flat())];
        }

        return specificGroups.map(mergePoliticianRowGroup);
      }

      const bestSpecificGroupIndex = specificGroups
        .map((group, index) => ({ index, row: [...group].sort(comparePoliticianQuality)[0] }))
        .sort((left, right) => comparePoliticianQuality(left.row, right.row))[0]?.index ?? 0;

      return specificGroups.map((group, index) =>
        mergePoliticianRowGroup(index === bestSpecificGroupIndex ? [...group, ...genericRows] : group));
    })
    .sort((left, right) => fallbackPoliticianName(left).localeCompare(fallbackPoliticianName(right), "en-US", { sensitivity: "base" }));
}

function uniqueByIdentity(rows: PoliticianRow[]) {
  const byIdentity = new Map<string, PoliticianRow>();

  rows.forEach((row) => {
    const key = getPoliticianIdentityKey(row);
    const existing = byIdentity.get(key);
    if (!existing || comparePoliticianQualityDesc(row, existing) < 0) {
      byIdentity.set(key, row);
    }
  });

  return [...byIdentity.values()];
}

function enforceFederalOfficeUniqueness(rows: PoliticianRow[]) {
  const federalRows = rows.filter((row) => row.jurisdiction_type === "federal");
  const nonFederalRows = rows.filter((row) => row.jurisdiction_type !== "federal");

  const identityResolved = uniqueByIdentity(federalRows);
  const senators = identityResolved.filter((row) => getOfficeFamilyForRow(row) === "senate");
  const representatives = identityResolved.filter((row) => getOfficeFamilyForRow(row) === "house");
  const otherFederal = identityResolved.filter((row) => {
    const family = getOfficeFamilyForRow(row);
    return family !== "senate" && family !== "house";
  });

  const chosenSenators = [...new Map(
    senators
      .filter((row) => Boolean(getStateCode(row)))
      .sort(comparePoliticianQualityDesc)
      .map((row) => [`${getStateCode(row)}|${getPoliticianIdentityKey(row)}`, row] as const),
  ).values()]
    .reduce<Map<string, PoliticianRow[]>>((accumulator, row) => {
      const state = getStateCode(row);
      const items = accumulator.get(state) || [];
      items.push(row);
      accumulator.set(state, items);
      return accumulator;
    }, new Map<string, PoliticianRow[]>());

  const senateRows = [...chosenSenators.values()]
    .flatMap((group) => group.sort(comparePoliticianQualityDesc).slice(0, 2));

  const representativeByDistrict = new Map<string, PoliticianRow>();

  representatives.forEach((row) => {
    if (!getStateCode(row)) {
      return;
    }
    const districtKey = getDistrictKey(row);
    if (!districtKey) {
      return;
    }

    const existing = representativeByDistrict.get(districtKey);
    if (!existing || comparePoliticianQualityDesc(row, existing) < 0) {
      representativeByDistrict.set(districtKey, row);
    }
  });

  const representativeRows = [...representativeByDistrict.values()];
  const occupiedIdentityKeys = new Set([
    ...senateRows.map(getPoliticianIdentityKey),
    ...representativeRows.map(getPoliticianIdentityKey),
  ]);
  const otherRows = otherFederal.filter((row) =>
    !occupiedIdentityKeys.has(getPoliticianIdentityKey(row))
    && !(row.source_system === "federal_votes" && !getStateCode(row)));

  return [...nonFederalRows, ...senateRows, ...representativeRows, ...otherRows]
    .sort((left, right) => fallbackPoliticianName(left).localeCompare(fallbackPoliticianName(right), "en-US", { sensitivity: "base" }));
}

function readRawString(row: PoliticianRow, key: string) {
  const value = getRawMemberRecord(row)[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * Recovers profile fields that the sync stored as placeholders but that are present in the
 * source payload we already persisted.
 *
 * The OpenStates /people endpoint only returns `links` and `offices` when they are explicitly
 * requested via `include`, which state-sync never did -- so it read `person.links[0].url` off a
 * payload that had no `links` key and wrote "Not available from configured sources" for all 210
 * state legislators. Their `openstates_url`, `email` and `birth_date` were captured in
 * `raw_member` the whole time. Reading them here fixes the existing rows with no resync.
 */
function resolveProfileField(row: PoliticianRow, stored: string, rawKeys: string[]) {
  if (!isPlaceholderText(stored)) {
    return stored;
  }

  for (const key of rawKeys) {
    const value = readRawString(row, key);
    if (value) {
      return value;
    }
  }

  return stored;
}

function mapRowToPolitician(row: PoliticianRow): Politician {
  const name = fallbackPoliticianName(row);

  return {
    id: row.id,
    slug: row.slug || row.id,
    name,
    title: getResolvedOfficeTitle(row),
    party: normalizePartyLabel(row.party),
    state: normalizeStateLabel(row.state),
    district: getResolvedDistrict(row) || undefined,
    biography: row.biography,
    born: resolveProfileField(row, row.born, ["birth_date"]),
    education: row.education,
    occupation: row.occupation,
    website: resolveProfileField(row, row.website, ["openstates_url", "officialWebsiteUrl", "url"]),
    officePhone: row.office_phone,
    officeAddress: row.office_address,
    nextElection: row.next_election,
    jurisdictionType: row.jurisdiction_type,
    sessionId: row.session_id || undefined,
    stats: row.stats,
    ideology: row.ideology,
    sourceMetadata: {
      sourceSystem: row.source_system || row.source,
      sourceId: row.source_id || row.id,
      syncedAt: row.synced_at,
      rawAvailable: Boolean(row.raw_payload || row.raw_member),
    },
  };
}

/**
 * Everything the read path maps, minus `raw_payload`.
 *
 * `raw_payload` and `raw_member` are byte-identical copies of the same Congress.gov member blob
 * (433KB each per 250 rows). Every consumer reads them as `raw_member ?? raw_payload`, so the
 * duplicate was pure wire cost -- roughly half of this table's payload.
 */
const POLITICIAN_LIST_SELECT = [
  "id",
  "slug",
  "name",
  "title",
  "party",
  "state",
  "district",
  "biography",
  "born",
  "education",
  "occupation",
  "website",
  "office_phone",
  "office_address",
  "next_election",
  "stats",
  "ideology",
  "source",
  "source_system",
  "source_id",
  "jurisdiction_type",
  "state_code",
  "session_id",
  "synced_at",
  "raw_member",
].join(",");

/**
 * @param options.fresh sync pipelines must observe current rows to compute diffs; the render
 * path reads through the cache.
 * @param options.jurisdictionType / options.stateCode scope the read. The directory only ever
 * shows one level at a time (and one state at a time), so it should not download every member of
 * every legislature to render 20 rows. The merge/dedupe below still sees the full set it needs,
 * because duplicates only ever occur within the same level and state.
 */
export const listStoredPoliticians = cache(async (options?: {
  fresh?: boolean;
  jurisdictionType?: "federal" | "state";
  stateCode?: string;
}) => {
  const conditions = [
    options?.jurisdictionType ? `jurisdiction_type=eq.${options.jurisdictionType}` : "",
    options?.stateCode ? `state_code=eq.${options.stateCode.toUpperCase()}` : "",
    "order=name.asc",
  ].filter(Boolean);

  const rows = await fetchSupabaseRows<PoliticianRow>("politicians", conditions.join("&"), {
    ...(options?.fresh
      ? { cache: "no-store" as const }
      : { tags: [POLITICIANS_CACHE_TAG] }),
    select: POLITICIAN_LIST_SELECT,
    paginateAll: true,
  });
  return enforceFederalOfficeUniqueness(mergeDuplicatePoliticianRows(rows))
    .filter((row) => row.jurisdiction_type !== "federal" || ["US Senator", "US Representative"].includes(getResolvedOfficeTitle(row)))
    .map(mapRowToPolitician);
});

/** The states we actually store legislators for, for the conditional state dropdown. */
export const listStoredPoliticianStates = cache(async () => {
  const rows = await fetchSupabaseRows<{ state_code: string | null }>(
    "politicians",
    "jurisdiction_type=eq.state&order=state_code.asc",
    { select: "state_code", tags: [POLITICIANS_CACHE_TAG], paginateAll: true },
  );

  return [...new Set(rows.map((row) => (row.state_code || "").toUpperCase()).filter(Boolean))].sort();
});

export async function getStoredPoliticianBySlug(slug: string) {
  const exactRows = await fetchSupabaseRows<PoliticianRow>(
    "politicians",
    `slug=eq.${encodeURIComponent(slug)}&limit=1`,
    { select: POLITICIAN_LIST_SELECT, tags: [POLITICIANS_CACHE_TAG] },
  );
  const exactRow = exactRows[0];
  if (exactRow) {
    return mapRowToPolitician(exactRow);
  }

  const rows = await fetchSupabaseRows<PoliticianRow>(
    "politicians",
    "order=name.asc",
    { select: POLITICIAN_LIST_SELECT, tags: [POLITICIANS_CACHE_TAG], paginateAll: true },
  );
  const mergedRows = enforceFederalOfficeUniqueness(mergeDuplicatePoliticianRows(rows))
    .filter((row) => row.jurisdiction_type !== "federal" || ["US Senator", "US Representative"].includes(getResolvedOfficeTitle(row)));
  const exactMatch = mergedRows.find((row) => row.slug === slug);
  if (exactMatch) {
    return mapRowToPolitician(exactMatch);
  }

  const rawMatch = rows.find((row) => row.slug === slug);
  if (!rawMatch) {
    return undefined;
  }

  const identityKey = getPoliticianIdentityKey(rawMatch);
  const mergedMatch = mergedRows.find((row) => getPoliticianIdentityKey(row) === identityKey);
  return mergedMatch ? mapRowToPolitician(mergedMatch) : undefined;
}

export async function getStoredPoliticianById(id: string) {
  const rows = await fetchSupabaseRows<PoliticianRow>(
    "politicians",
    `id=eq.${encodeURIComponent(id)}&limit=1`,
    { cache: "no-store" },
  );
  const row = rows[0];
  return row ? mapRowToPolitician(row) : undefined;
}

export async function upsertStoredPoliticians(rows: PoliticianRow[]) {
  return upsertSupabaseRows("politicians", rows, "id");
}
