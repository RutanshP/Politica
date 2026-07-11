import type { Politician } from "@/types/civic";
import type { PoliticianRow } from "@/types/supabase";
import { fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";
import { normalizeDistrictSeat, normalizeOfficeTitle, normalizePartyLabel, normalizePersonLookup, normalizeStateCode, normalizeStateLabel } from "@/lib/utils";

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

function readRawCongressDistrict(row: PoliticianRow) {
  const rawMember = getRawMemberRecord(row);
  const directDistrict = typeof rawMember.district === "string" || typeof rawMember.district === "number"
    ? rawMember.district
    : undefined;
  const terms = rawMember.terms;
  const termItem = terms && typeof terms === "object" && "item" in terms
    ? (terms as { item?: Array<{ district?: number | string }> | { district?: number | string } }).item
    : undefined;
  const firstTerm = Array.isArray(termItem) ? termItem[0] : termItem;
  const firstTermDistrict = typeof firstTerm?.district === "string" || typeof firstTerm?.district === "number"
    ? firstTerm.district
    : undefined;
  const candidate = directDistrict ?? firstTermDistrict;

  if (candidate === undefined || candidate === null || candidate === "") {
    return null;
  }

  return normalizeDistrictSeat(row.state_code || row.state, candidate) || null;
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
    born: row.born,
    education: row.education,
    occupation: row.occupation,
    website: row.website,
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

export async function listStoredPoliticians() {
  const rows = await fetchSupabaseRows<PoliticianRow>("politicians", "order=name.asc", {
    cache: "no-store",
  });
  return enforceFederalOfficeUniqueness(mergeDuplicatePoliticianRows(rows))
    .filter((row) => row.jurisdiction_type !== "federal" || ["US Senator", "US Representative"].includes(getResolvedOfficeTitle(row)))
    .map(mapRowToPolitician);
}

export async function getStoredPoliticianBySlug(slug: string) {
  const rows = await fetchSupabaseRows<PoliticianRow>(
    "politicians",
    "order=name.asc",
    { cache: "no-store" },
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

export async function upsertStoredPoliticians(rows: PoliticianRow[]) {
  return upsertSupabaseRows("politicians", rows, "id");
}
