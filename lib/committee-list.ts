import {
  deriveCommitteeSector,
  normalizeCommitteeField,
  normalizeStateLabel,
} from "@/lib/utils";
import type { Committee } from "@/types/civic";

/**
 * One directory row: what the table filters, sorts and shows, and nothing else.
 *
 * The page used to hand this client component whole Committee objects -- every committee's full
 * activeBillIds list (659 ids for House Agriculture alone), member ids and description -- only for
 * the table to print `.length` of two of them. That made /committees a 642KB document.
 */
export interface CommitteeListItem {
  id: string;
  slug: string;
  name: string;
  chamber: string;
  level: "Federal" | "State";
  stateLabel: string;
  sector: string;
  hearingLabel: string;
  hearingStatus: "No hearing" | "Hearing scheduled";
  memberCount: number;
  activeBillCount: number;
}

export function toCommitteeListItems(committees: Committee[]): CommitteeListItem[] {
  return committees
    // A legislature chamber is not a committee; see Committee.isChamberRecord.
    .filter((committee) => !committee.isChamberRecord)
    .map((committee) => {
      const hearingLabel = normalizeCommitteeField(committee.hearing, "No hearing scheduled");
      return {
        id: committee.id,
        slug: committee.slug,
        name: committee.name,
        chamber: committee.chamber,
        level: committee.jurisdictionType === "state" ? "State" : "Federal",
        stateLabel: committee.state ? normalizeStateLabel(committee.state) : "",
        sector: deriveCommitteeSector(committee),
        hearingLabel,
        hearingStatus: hearingLabel === "No hearing scheduled" ? "No hearing" : "Hearing scheduled",
        memberCount: committee.memberIds.length,
        activeBillCount: committee.activeBillIds.length,
      };
    });
}

