import type { CongressMemberDetailPayload, CongressMemberListItem } from "@/types/congress";
import type { Politician } from "@/types/civic";
import type { PoliticianRow } from "@/types/supabase";
import { slugifySegment } from "@/lib/utils";

function buildTitle(chamber?: string) {
  return chamber === "House of Representatives"
    ? "United States Representative"
    : "United States Senator";
}

export function normalizeCongressMemberToPolitician(
  member: CongressMemberListItem,
  detail?: CongressMemberDetailPayload,
) {
  const detailMember = detail?.member;
  const name = member.invertedOrderName
    ? member.invertedOrderName.split(",").reverse().join(" ").trim()
    : [member.honorificName, member.firstName, member.lastName].filter(Boolean).join(" ").trim();
  const currentTerm = detailMember?.terms?.item?.[0] || member.terms?.item?.[0];
  const id = member.bioguideId || slugifySegment(name);

  return {
    id,
    slug: slugifySegment(name),
    name,
    title: buildTitle(currentTerm?.chamber),
    party: detailMember?.partyName || member.partyName || "Unknown",
    state: detailMember?.state || member.state || "Federal",
    district:
      currentTerm?.district && Number(currentTerm.district) > 0
        ? `${detailMember?.state || member.state}-${currentTerm.district}`
        : undefined,
    biography: `${buildTitle(currentTerm?.chamber)} from ${detailMember?.state || member.state || "Federal"}. Synced from Congress.gov via scheduled ingestion.`,
    born: "Not available from configured sources",
    education: "Not available from configured sources",
    occupation: "Public official",
    website: "www.congress.gov/member",
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
    state_code: politician.state || null,
    session_id: politician.sessionId || null,
    synced_at: new Date().toISOString(),
    raw_payload: rawMember,
    raw_member: rawMember,
  };
}
