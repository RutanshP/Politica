/*
 * Pure helpers for Lobbying Disclosure Act data: no I/O, so they are shared by the sync, the data
 * layer and the unit tests.
 */

/** The LDA's general issue codes, as its /constants/filing/lobbyingactivityissues/ lists them. */
export const LDA_ISSUE_NAMES: Record<string, string> = {
  ACC: "Accounting",
  ADV: "Advertising",
  AER: "Aerospace",
  AGR: "Agriculture",
  ALC: "Alcohol and Drug Abuse",
  ANI: "Animals",
  APP: "Apparel/Clothing Industry/Textiles",
  ART: "Arts/Entertainment",
  AUT: "Automotive Industry",
  AVI: "Aviation/Airlines/Airports",
  BAN: "Banking",
  BNK: "Bankruptcy",
  BEV: "Beverage Industry",
  BUD: "Budget/Appropriations",
  CIV: "Civil Rights/Civil Liberties",
  CHM: "Chemicals/Chemical Industry",
  CAW: "Clean Air and Water (quality)",
  CDT: "Commodities (big ticket)",
  COM: "Communications/Broadcasting/Radio/TV",
  CPI: "Computer Industry",
  CON: "Constitution",
  CSP: "Consumer Issues/Safety/Products",
  CPT: "Copyright/Patent/Trademark",
  DEF: "Defense",
  DIS: "Disaster Planning/Emergencies",
  DOC: "District of Columbia",
  ECN: "Economics/Economic Development",
  EDU: "Education",
  ENG: "Energy/Nuclear",
  ENV: "Environment/Superfund",
  FAM: "Family issues/Abortion/Adoption",
  FIN: "Financial Institutions/Investments/Securities",
  FIR: "Firearms/Guns/Ammunition",
  FOO: "Food Industry (safety, labeling, etc.)",
  FOR: "Foreign Relations",
  FUE: "Fuel/Gas/Oil",
  GAM: "Gaming/Gambling/Casino",
  GOV: "Government Issues",
  HCR: "Health Issues",
  HOM: "Homeland Security",
  HOU: "Housing",
  IMM: "Immigration",
  IND: "Indian/Native American Affairs",
  INS: "Insurance",
  INT: "Intelligence",
  LBR: "Labor Issues/Antitrust/Workplace",
  LAW: "Law Enforcement/Crime/Criminal Justice",
  MAN: "Manufacturing",
  MAR: "Marine/Maritime/Boating/Fisheries",
  MIA: "Media (information/publishing)",
  MED: "Medical/Disease Research/Clinical Labs",
  MMM: "Medicare/Medicaid",
  MON: "Minting/Money/Gold Standard",
  NAT: "Natural Resources",
  PHA: "Pharmacy",
  POS: "Postal",
  RRR: "Railroads",
  RES: "Real Estate/Land Use/Conservation",
  REL: "Religion",
  RET: "Retirement",
  ROD: "Roads/Highway",
  SCI: "Science/Technology",
  SMB: "Small Business",
  SPO: "Sports/Athletics",
  TAR: "Tariff (miscellaneous tariff bills)",
  TAX: "Taxation/Internal Revenue Code",
  TEC: "Telecommunications",
  TOB: "Tobacco",
  TOR: "Torts",
  TRD: "Trade (domestic/foreign)",
  TRA: "Transportation",
  TOU: "Travel/Tourism",
  TRU: "Trucking/Shipping",
  URB: "Urban Development/Municipalities",
  UNM: "Unemployment",
  UTI: "Utilities",
  VET: "Veterans",
  WAS: "Waste (hazardous/solid/interstate/nuclear)",
  WEL: "Welfare",
};

export function issueName(code: string) {
  return LDA_ISSUE_NAMES[code] ?? code;
}

export const QUARTER_PERIODS = ["first_quarter", "second_quarter", "third_quarter", "fourth_quarter"] as const;
export type QuarterPeriod = (typeof QUARTER_PERIODS)[number];

export function quarterNumber(period: string | null | undefined) {
  const index = QUARTER_PERIODS.indexOf(period as QuarterPeriod);
  return index === -1 ? null : index + 1;
}

/** "Q2 2026" */
export function quarterLabel(year: number, period: string | null | undefined) {
  const quarter = quarterNumber(period);
  return quarter ? `Q${quarter} ${year}` : String(year);
}

/**
 * Registrations say who lobbies for whom but report no money or activity; everything else --
 * quarterly reports, their amendments and terminations, and the "no activity" variants -- is a
 * report for one quarter, and the latest one posted for a firm/client/quarter is the one that
 * counts.
 */
export function isQuarterlyReport(filingType: string | null | undefined, period: string | null | undefined) {
  return Boolean(filingType) && filingType !== "RR" && filingType !== "RA" && quarterNumber(period) !== null;
}

/** The filing's own page on lda.gov. Derived rather than stored: it is the uuid in a fixed path. */
export function filingDocumentUrl(filingUuid: string) {
  return `https://lda.gov/filings/public/filing/${filingUuid}/print/`;
}

/*
 * Bill citations in free-text activity descriptions: "H.R. 4930", "HR 1", "S.2677", "H. Res. 45",
 * "S.J.Res. 7". Longest prefixes first, so "H.J.Res. 7" is not read as "H. 7". The lookbehind
 * keeps "U.S. 1" and "vs. 5" from reading as Senate bills.
 */
const BILL_PREFIXES: Array<[string, RegExp]> = [
  ["hconres", /H\.?\s*Con\.?\s*Res\.?/],
  ["sconres", /S\.?\s*Con\.?\s*Res\.?/],
  ["hjres", /H\.?\s*J\.?\s*Res\.?/],
  ["sjres", /S\.?\s*J\.?\s*Res\.?/],
  ["hres", /H\.?\s*Res\.?/],
  ["sres", /S\.?\s*Res\.?/],
  ["hr", /H\.?\s*R\.?/],
  ["s", /S\.?/],
];
const BILL_PATTERN = new RegExp(
  String.raw`(?<![A-Za-z.])(?:` +
    BILL_PREFIXES.map(([, re], index) => `(?<p${index}>${re.source})`).join("|") +
    String.raw`)\s*(?<n>\d{1,5})(?![\d-])`,
  "gi",
);
// "H.R. 8413 (118th Congress)" or "S. 12, 118th Congress" cites a bill from another Congress,
// which this app does not store under that id.
const OTHER_CONGRESS = /^\s*,?\s*(?:\((1[01]\d)(?:st|nd|rd|th)?(?:\s*Congress)?\)|(?:of\s+the\s+|in\s+the\s+)?(1[01]\d)(?:st|nd|rd|th)\s+Congress)/i;

/**
 * Bill ids ("hr-4930") cited in a description, for a filing in the given Congress. Citations
 * that name an earlier Congress are dropped; the caller keeps only ids that exist as stored bills.
 */
export function extractBillMentions(text: string | null | undefined, congress = 119) {
  const found = new Set<string>();
  if (!text) return found;
  for (const match of text.matchAll(BILL_PATTERN)) {
    const groups = match.groups ?? {};
    const index = BILL_PREFIXES.findIndex((_, i) => groups[`p${i}`] !== undefined);
    const number = Number(groups.n);
    if (index === -1 || !number) continue;
    const after = text.slice((match.index ?? 0) + match[0].length);
    const other = after.match(OTHER_CONGRESS);
    if (other && Number(other[1] ?? other[2]) !== congress) continue;
    found.add(`${BILL_PREFIXES[index][0]}-${number}`);
  }
  return found;
}

/** The Congress in session for a filing year: 2025 and 2026 are the 119th. */
export function congressForYear(year: number) {
  return Math.floor((year - 1789) / 2) + 1;
}
