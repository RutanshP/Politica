import type { FecCommitteeDetailRow } from "@/lib/adapters/fec";

/**
 * What kind of committee gave money to a member, for the Congress money network.
 *
 * Read off the FEC committee record: `designation` (J joint fundraiser, D leadership PAC, P/A a
 * candidate's own), `committee_type` (H/S/P campaigns, X/Y/Z party, O/U/V/W super PACs and
 * hybrids) and, for connected PACs, `organization_type` (C corporation, W corporation without
 * stock, L labor, T trade, M membership, V cooperative).
 */
export type PacCategory =
  | "corporate"
  | "labor"
  | "trade"
  | "ideological"
  | "super_pac"
  | "party"
  | "leadership"
  | "campaign";

export const PAC_CATEGORY_LABEL: Record<PacCategory, string> = {
  corporate: "Corporate PAC",
  labor: "Labor PAC",
  trade: "Trade & membership PAC",
  ideological: "Ideological PAC",
  super_pac: "Super PAC / hybrid",
  party: "Party committee",
  leadership: "Leadership PAC",
  campaign: "Another member's campaign",
};

/**
 * Null means "not a PAC gift": joint fundraising committees only pass through money individuals
 * already gave, so counting them would double-count and hide who actually gave.
 */
export function classifyCommittee(row: Pick<FecCommitteeDetailRow, "committee_type" | "designation" | "organization_type">): PacCategory | null {
  const type = (row.committee_type || "").toUpperCase();
  const designation = (row.designation || "").toUpperCase();
  const organization = (row.organization_type || "").toUpperCase();

  if (designation === "J") return null;
  if (type === "H" || type === "S" || type === "P") return "campaign";
  if (designation === "D") return "leadership";
  if (type === "X" || type === "Y" || type === "Z") return "party";
  if (organization === "C" || organization === "W") return "corporate";
  if (organization === "L") return "labor";
  if (organization === "T" || organization === "M" || organization === "V") return "trade";
  if (type === "O" || type === "U" || type === "V" || type === "W") return "super_pac";
  return "ideological";
}

/**
 * The member a committee belongs to, when it belongs to one: a leadership PAC names its sponsor,
 * a campaign committee its candidate. Resolved through FEC candidate ids to bioguide ids.
 */
export function committeeOwner(
  row: Pick<FecCommitteeDetailRow, "sponsor_candidate_ids" | "candidate_ids">,
  category: PacCategory,
  bioguideByFecId: Map<string, string>,
) {
  const candidateIds = category === "leadership"
    ? row.sponsor_candidate_ids
    : category === "campaign"
      ? row.candidate_ids
      : null;
  for (const fecId of candidateIds ?? []) {
    const bioguide = bioguideByFecId.get(fecId);
    if (bioguide) return bioguide;
  }
  return null;
}
