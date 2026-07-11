export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function slugifySegment(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

const PARTY_NAMES: Record<string, string> = {
  D: "Democratic",
  DEM: "Democratic",
  DEMOCRAT: "Democratic",
  DEMOCRATIC: "Democratic",
  R: "Republican",
  REP: "Republican",
  REPUBLICAN: "Republican",
  I: "Independent",
  IND: "Independent",
  INDEPENDENT: "Independent",
};

export function normalizeStateLabel(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) return "Unknown";

  const upper = normalized.toUpperCase();
  if (STATE_NAMES[upper]) {
    return STATE_NAMES[upper];
  }

  return normalized;
}

export function normalizePartyLabel(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) return "Unknown";

  const upper = normalized.toUpperCase();
  return PARTY_NAMES[upper] || normalized;
}

export function hasVotePerformanceStats(stats: {
  votesWithParty: number;
  votesAgainstParty: number;
  attendance: number;
}) {
  return stats.votesWithParty > 0 || stats.votesAgainstParty > 0 || stats.attendance > 0;
}

export function sortLabelsAlphabetically(values: Array<string | null | undefined>) {
  return [...new Set(values.filter(Boolean) as string[])].sort((left, right) =>
    left.localeCompare(right, "en-US", { sensitivity: "base" }),
  );
}

const COMMITTEE_SECTOR_KEYWORDS: Array<{ sector: string; keywords: string[] }> = [
  { sector: "Agriculture", keywords: ["agriculture", "farm", "food"] },
  { sector: "Budget", keywords: ["budget", "appropriation", "finance", "tax", "revenue"] },
  { sector: "Defense", keywords: ["armed", "defense", "military", "veterans"] },
  { sector: "Education", keywords: ["education", "school", "student", "workforce", "labor"] },
  { sector: "Energy", keywords: ["energy", "natural resources", "climate", "environment", "water"] },
  { sector: "Foreign Policy", keywords: ["foreign", "international", "homeland", "intelligence"] },
  { sector: "Government", keywords: ["rules", "oversight", "judiciary", "government", "administration"] },
  { sector: "Health", keywords: ["health", "medical", "medicare", "medicaid", "public health"] },
  { sector: "Infrastructure", keywords: ["transportation", "infrastructure", "public works", "housing"] },
  { sector: "Technology", keywords: ["science", "technology", "commerce", "communications", "innovation"] },
];

export function deriveCommitteeSector(input: {
  name: string;
  jurisdiction?: string;
  description?: string;
}) {
  const haystack = `${input.name} ${input.jurisdiction || ""} ${input.description || ""}`.toLowerCase();
  const match = COMMITTEE_SECTOR_KEYWORDS.find(({ keywords }) =>
    keywords.some((keyword) => haystack.includes(keyword)));
  return match?.sector || "General";
}

export function normalizeCommitteeField(value: string, fallback: string) {
  const normalized = value.trim();
  const knownPlaceholders = new Set([
    "Not available from configured sources",
    "Chair roster not connected from Congress.gov yet",
    "Ranking member roster not connected from Congress.gov yet",
    "State hearing calendar not connected",
    "Hearing calendar sync not connected yet",
  ]);

  return knownPlaceholders.has(normalized) ? fallback : normalized;
}

export function normalizePersonLookup(value?: string | null) {
  const normalized = (value || "")
    .toLowerCase()
    .replace(/\b(rep|representative|sen|senator|mr|mrs|ms|dr)\.?\b/g, " ")
    .replace(/[^a-z0-9\s,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  if (normalized.includes(",")) {
    return normalized
      .split(",")
      .reverse()
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return normalized;
}
