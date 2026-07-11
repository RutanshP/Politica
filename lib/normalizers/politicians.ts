import type { CongressMemberDetailPayload, CongressMemberListItem } from "@/types/congress";
import type { Politician } from "@/types/civic";
import type { PoliticianRow } from "@/types/supabase";
import { normalizeDistrictSeat, normalizeOfficeTitle, normalizeStateCode, slugifySegment } from "@/lib/utils";

function buildTitle(chamber?: string) {
  return normalizeOfficeTitle(
    chamber === "House of Representatives" ? "Representative" : "Senator",
    { jurisdictionType: "federal" },
  );
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildCongressDistrict(
  state: string | undefined,
  district: number | string | undefined,
) {
  return normalizeDistrictSeat(state, district) || undefined;
}

function toYear(value?: number | string) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : -1;
}

function chooseCurrentTerm(
  member: CongressMemberListItem,
  detail?: CongressMemberDetailPayload,
) {
  const detailTerms = detail?.member?.terms?.item ?? [];
  const listTerms = member.terms?.item ?? [];
  const terms = (detailTerms.length > 0 ? detailTerms : listTerms).filter(Boolean);

  if (terms.length === 0) {
    return undefined;
  }

  const preferred = [...terms].sort((left, right) =>
    toYear(right.startYear) - toYear(left.startYear)
    || toYear(right.endYear) - toYear(left.endYear)
    || String(right.chamber || "").localeCompare(String(left.chamber || ""), "en-US", { sensitivity: "base" })
  )[0];

  return preferred;
}

function buildMemberName(
  member: CongressMemberListItem,
  detail?: CongressMemberDetailPayload,
) {
  const detailMember = detail?.member;
  const directName = normalizeWhitespace([
    detailMember?.honorificName || member.honorificName,
    detailMember?.firstName || member.firstName,
    detailMember?.lastName || member.lastName,
  ].filter(Boolean).join(" "));

  const inverted = normalizeWhitespace(
    (detailMember?.invertedOrderName || member.invertedOrderName || "")
      .split(",")
      .reverse()
      .join(" "),
  );

  const cleanedInverted = inverted.replace(/^,+|,+$/g, "").trim();

  if (cleanedInverted.length > 1) {
    return cleanedInverted;
  }

  if (directName.length > 1) {
    return directName;
  }

  const fallback = normalizeWhitespace([
    detailMember?.firstName,
    detailMember?.lastName,
  ].filter(Boolean).join(" "));

  return fallback || member.bioguideId || "Congress Member";
}

export function normalizeCongressMemberToPolitician(
  member: CongressMemberListItem,
  detail?: CongressMemberDetailPayload,
) {
  const detailMember = detail?.member;
  const name = buildMemberName(member, detail);
  const currentTerm = chooseCurrentTerm(member, detail);
  const id = member.bioguideId || slugifySegment(name);
  const state = detailMember?.state || member.state || "Federal";

  return {
    id,
    slug: slugifySegment(name),
    name,
    title: buildTitle(currentTerm?.chamber),
    party: detailMember?.partyName || member.partyName || "Unknown",
    state,
    district: buildCongressDistrict(state, currentTerm?.district ?? member.district),
    biography: `${buildTitle(currentTerm?.chamber)} from ${state}. Synced from Congress.gov via scheduled ingestion.`,
    born: "Not available from configured sources",
    education: "Not available from configured sources",
    occupation: "Public official",
    website: detailMember?.officialWebsiteUrl || "www.congress.gov/member",
    officePhone: detailMember?.addressInformation?.phoneNumber || "Not available from configured sources",
    officeAddress: detailMember?.addressInformation?.officeAddress || "Office address not available from configured sources",
    nextElection: "Election calendar not connected",
    stats: {
      votesWithParty: 0,
      votesAgainstParty: 0,
      attendance: 0,
      billsIntroduced: detailMember?.sponsoredLegislation?.count ?? 0,
      billsPassed: 0,
      amendmentsOffered: 0,
    },
    ideology: {},
    jurisdictionType: "federal",
    sourceMetadata: {
      sourceSystem: "congress",
      sourceId: id,
      rawAvailable: Boolean(detailMember || member),
    },
  } satisfies Politician;
}

export function mapPoliticianToRow(politician: Politician, rawMember: unknown): PoliticianRow {
  return {
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
    source: "congress_sync",
    source_system: politician.sourceMetadata?.sourceSystem || "congress",
    source_id: politician.sourceMetadata?.sourceId || politician.id,
    jurisdiction_type: politician.jurisdictionType || "federal",
    state_code: normalizeStateCode(politician.state) || politician.state || null,
    session_id: politician.sessionId || null,
    synced_at: new Date().toISOString(),
    raw_payload: rawMember,
    raw_member: rawMember,
  };
}
