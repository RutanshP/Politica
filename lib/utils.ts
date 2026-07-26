export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&rdquo;": "”",
  "&ldquo;": "“",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
  "&sect;": "§",
};

/**
 * Congress.gov summaries arrive as HTML (`<p><strong>Title</strong></p><p>...</p><ul><li>...`).
 * Rendering that raw shows the tags; using dangerouslySetInnerHTML on an external source is an
 * injection risk. This converts the markup to clean text that preserves paragraph and list
 * structure, safe to render with `whitespace-pre-line`.
 */
export function formatSummaryText(value?: string | null): string {
  if (!value) return "";

  let text = value
    .replace(/<\s*(br|BR)\s*\/?>/g, "\n")
    .replace(/<\/\s*(p|div|h[1-6]|tr)\s*>/gi, "\n\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\/\s*li\s*>/gi, "")
    .replace(/<[^>]+>/g, ""); // strip any remaining tags

  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
  text = text.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    text = text.split(entity).join(char);
  }

  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Single-line variant of formatSummaryText, for fields rendered inline: titles, action labels,
 * headlines. Congress.gov ships these with markup too ("Housing for the 21st Century Act<br/>"),
 * which showed up literally in tables and card headings.
 */
export function formatInlineText(value?: string | null): string {
  return formatSummaryText(value).replace(/\s*\n+\s*/g, " ").trim();
}

/** "Jul 15, 2026" from an ISO timestamp; passes through anything it can't parse. */
export function formatDateLabel(value?: string | null): string {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * OpenStates bill ids look like "ocd-bill/4210e4e2-...", a literal "/" embedded in what the app
 * treats as a single [billId] route segment. A plain template-literal href turns that into a
 * 3-segment path that 404s -- encodeURIComponent keeps it one segment; Next decodes it straight
 * back to the original id (slash included) when reading the route param.
 */
export function billHref(billId: string, suffix = "") {
  return `/bills/${encodeURIComponent(billId)}${suffix}`;
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
  AS: "American Samoa",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  GU: "Guam",
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
  MP: "Northern Mariana Islands",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  PR: "Puerto Rico",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  VI: "Virgin Islands",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

const STATE_CODES_BY_NAME = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([code, name]) => [name.toUpperCase(), code]),
) as Record<string, string>;

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

export function normalizeStateCode(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) return "";

  const upper = normalized.toUpperCase();
  if (STATE_NAMES[upper]) {
    return upper;
  }

  return STATE_CODES_BY_NAME[upper] || "";
}

export function normalizeDistrictSeat(
  state?: string | null,
  district?: string | number | null,
) {
  const stateCode = normalizeStateCode(state);
  const districtText = String(district ?? "").trim();
  if (!districtText) {
    return "";
  }

  const districtNumber = Number(districtText);
  if (Number.isFinite(districtNumber)) {
    if (!stateCode) {
      return "";
    }
    return districtNumber <= 0 ? `${stateCode}-AL` : `${stateCode}-${districtNumber}`;
  }

  const normalized = districtText.toUpperCase().replace(/\s+/g, "");
  if (!normalized.includes("-")) {
    if (!stateCode) {
      return "";
    }
    return normalized === "AL" ? `${stateCode}-AL` : `${stateCode}-${normalized}`;
  }

  const hyphenIndex = normalized.indexOf("-");
  const suffix = hyphenIndex >= 0 ? normalized.slice(hyphenIndex + 1) : normalized;
  if (!suffix) {
    return "";
  }

  if (!stateCode) {
    const prefix = hyphenIndex >= 0 ? normalized.slice(0, hyphenIndex) : "";
    return STATE_NAMES[prefix] ? normalized : "";
  }

  return `${stateCode}-${suffix}`;
}

export function normalizePartyLabel(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) return "Unknown";

  const upper = normalized.toUpperCase();
  return PARTY_NAMES[upper] || normalized;
}

export function normalizeOfficeTitle(
  title?: string | null,
  options?: {
    jurisdictionType?: string | null;
    state?: string | null;
  },
) {
  const normalized = (title || "").trim();
  if (!normalized) {
    return options?.jurisdictionType === "state"
      ? `${normalizeStateLabel(options?.state)} Legislator`
      : "US Legislator";
  }

  const lower = normalized.toLowerCase();
  const stateName = normalizeStateLabel(options?.state);

  if (options?.jurisdictionType === "federal") {
    if (/(house|representative)/i.test(normalized)) {
      return "US Representative";
    }
    if (/senator/i.test(normalized)) {
      return "US Senator";
    }
    if (/legislator/i.test(normalized)) {
      return "US Legislator";
    }
  }

  if (options?.jurisdictionType === "state") {
    if (/(upper|senate|senator)/i.test(lower)) {
      return `${stateName} Senator`;
    }
    if (/(lower|house|assembly|delegate|representative)/i.test(lower)) {
      return `${stateName} Representative`;
    }
    if (/legislator/i.test(lower)) {
      return `${stateName} Legislator`;
    }
  }

  return normalized;
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

export const COMMITTEE_CHAMBER_UNSPECIFIED = "Unspecified";

/**
 * Congress.gov already says House / Senate / Joint. OpenStates says upper / lower, which is the
 * same distinction in different vocabulary -- upper is the state senate, lower is the state
 * house (called the Assembly or House of Delegates in some states), so they fold together with
 * no loss of meaning.
 *
 * Returns null when the value carries no chamber information, so callers can pick their own
 * fallback: a committee's chamber can legitimately be unknown, a roll call's cannot.
 *
 * This never distinguishes federal from state -- that is what `jurisdiction_type` is for. Before
 * that column existed, state roll calls were relabelled into the federal words and became
 * indistinguishable from them.
 */
export function normalizeChamber(value?: string | null): "Senate" | "House" | "Joint" | null {
  const normalized = (value || "").trim().toLowerCase();

  if (normalized === "upper" || normalized === "senate") return "Senate";
  if (normalized === "lower" || normalized === "house" || normalized === "assembly") return "House";
  if (normalized === "joint") return "Joint";
  return null;
}

export function normalizeCommitteeChamber(value?: string | null) {
  const normalized = (value || "").trim().toLowerCase();
  const chamber = normalizeChamber(value);
  if (chamber) return chamber;

  // "committee" is what OpenStates emits when a committee hangs off a parent chamber org we do
  // not store, so its chamber genuinely is unknown rather than guessable.
  if (!normalized || normalized === "committee" || normalized === "legislature") {
    return COMMITTEE_CHAMBER_UNSPECIFIED;
  }

  return value as string;
}

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

/** Single-letter party label (D / R / I) for compact member rows. */
export function partyAbbrev(party?: string | null) {
  if (!party) return "";
  const first = party.trim()[0]?.toUpperCase();
  return first === "D" || first === "R" || first === "I" ? first : (first ?? "");
}

export function normalizePersonLookup(value?: string | null) {
  const normalized = (value || "")
    .toLowerCase()
    // Fold diacritics to their base letter before stripping punctuation. Without this the
    // [^a-z0-9\s,] pass turns the accent itself into a space -- "Ben Ray Luján" became
    // "ben ray luj n", which never matches the roll call's "ben lujan".
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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
