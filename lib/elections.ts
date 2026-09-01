import { normalizeDistrictSeat, normalizePartyLabel, normalizeStateLabel } from "@/lib/utils";

/**
 * Federal races only. The FEC files candidates for three offices -- House, Senate and President --
 * and nothing else: there is no state legislature or governor data in this feed to exclude. State
 * coverage elsewhere in the app is the governors, and they are stored in `politicians`, not here.
 */
export const FEDERAL_OFFICES = ["S", "H", "P"] as const;
export type FederalOffice = (typeof FEDERAL_OFFICES)[number];

/** The cycle the directory shows. Overridable so a later cycle needs no code change. */
export const ELECTION_CYCLE = Number.parseInt(
  process.env.POLITICA_ELECTION_CYCLE?.trim() || "2026",
  10,
);

/**
 * Candidate filings move at FEC filing-deadline pace, not daily, and the sync runs on Mondays
 * (see .github/workflows/sync-daily.yml). Eight days is one missed Monday plus a day of slack --
 * long enough not to cry stale between runs, short enough to notice a sync that has stopped.
 */
export const ELECTIONS_STALE_AFTER_HOURS = 8 * 24;

export const OFFICE_LABELS: Record<string, string> = {
  S: "Senate",
  H: "House",
  P: "President",
};

/** Honorifics and post-nominals the FEC lets candidates type into their own name field. */
const TITLE_TOKENS = new Set([
  "MR", "MRS", "MS", "MISS", "DR", "HON", "THE", "SEN", "SENATOR", "REP",
  "REPRESENTATIVE", "GOV", "JUDGE", "PROF", "REV", "CAPT", "COL", "SGT", "MAJ",
  "LT", "CMDR", "COMMANDER", "USN", "USA", "USAF", "USMC", "RET", "PASTOR",
]);

/** Generational suffixes, which belong after the surname rather than in front of it. */
const SUFFIX_TOKENS = new Set(["JR", "SR", "II", "III", "IV", "V", "VI"]);

const ROMAN_SUFFIX = /^(?:II|III|IV|V|VI)$/;

function stripTrailingDot(token: string) {
  return token.replace(/\.+$/, "");
}

/**
 * Title-cases one word, leaving the shapes that are not simply capitalised alone: roman-numeral
 * suffixes, initials, and the Mc/O'/hyphen forms where the second part carries a capital too.
 */
function capitalizeWord(word: string): string {
  if (!word) return word;
  if (ROMAN_SUFFIX.test(word.toUpperCase()) && word.length > 1) return word.toUpperCase();

  // Hyphenated and apostrophed names capitalise on both sides: SMITH-JONES, O'DONNELL.
  if (word.includes("-")) return word.split("-").map(capitalizeWord).join("-");
  if (word.includes("'")) {
    const [head, ...rest] = word.split("'");
    // Only a one-letter prefix takes a capital after the apostrophe (O'Donnell, D'Arrigo).
    // Otherwise it is a possessive or a nickname quote and the tail stays lowercase.
    const tail = rest.join("'");
    const capTail = head.length === 1 ? capitalizeWord(tail) : tail.toLowerCase();
    return `${capitalizeWord(head)}'${capTail}`;
  }

  const lower = word.toLowerCase();
  // "Mc" is safe to split; "Mac" is not -- MACK and MACON are ordinary words, not MacK/MacOn.
  if (lower.startsWith("mc") && lower.length > 3) {
    return `Mc${lower.charAt(2).toUpperCase()}${lower.slice(3)}`;
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function titleCase(value: string) {
  return value.split(/\s+/).filter(Boolean).map(capitalizeWord).join(" ");
}

/**
 * Title-cases and drops honorifics, but keeps word order. Used on the shapes that are too messy
 * to reorder -- they should still not read "... Gee T Mr.".
 */
function titleCaseWithoutHonorifics(value: string) {
  const kept = value
    .split(/\s+/)
    .filter((token) => {
      const bare = stripTrailingDot(token).replace(/[()]/g, "").toUpperCase();
      return bare.length > 0 && !TITLE_TOKENS.has(bare);
    });
  // Never let stripping empty the name out entirely.
  return kept.length > 0 ? titleCase(kept.join(" ")) : titleCase(value);
}

/**
 * Turns an FEC name into something readable.
 *
 * The feed is candidate-typed and mostly "LAST, FIRST MIDDLE", but it also carries honorifics
 * ("GOSAR, PAUL DR."), post-nominals ("WENDELIN, STEVEN COMMANDER USN, (RET)"), credentials in the
 * surname slot ("RAZACK, MD JD, NIZAM") and stray punctuation ("BRINK,, BRIDGET").
 *
 * Anything with a clean "surname, given names" shape is reordered. Anything messier is only
 * title-cased -- a mangled reordering of a real person's name is worse than an unreordered one.
 */
export function formatCandidateName(raw?: string | null): string {
  const value = (raw || "").trim().replace(/\s+/g, " ");
  if (!value) return "Unknown";

  const segments = value.split(",").map((part) => part.trim()).filter(Boolean);

  // No comma: already given-name-first, or a single token.
  if (segments.length <= 1) return titleCaseWithoutHonorifics(value);

  // Three or more real segments is not a shape we can trust -- title-case and leave the order be.
  if (segments.length > 2) {
    const suffix = segments[segments.length - 1];
    const isSuffix = SUFFIX_TOKENS.has(stripTrailingDot(suffix).toUpperCase());
    if (!isSuffix) return titleCaseWithoutHonorifics(segments.join(" "));
    // "CARL, JERRY LEE, JR" -- a genuine suffix on the end, so the first two parts still reorder.
    const reordered = formatCandidateName(`${segments[0]}, ${segments.slice(1, -1).join(" ")}`);
    return `${reordered} ${titleCase(suffix)}`;
  }

  const [surnamePart, givenPart] = segments;

  const clean = (part: string) =>
    part
      .split(/\s+/)
      .filter((token) => {
        const bare = stripTrailingDot(token).replace(/[()]/g, "").toUpperCase();
        return bare.length > 0 && !TITLE_TOKENS.has(bare);
      });

  const surnameTokens = clean(surnamePart);
  const givenTokensAll = clean(givenPart);

  // A trailing generational suffix in the given-name slot ("MCGUIRE, JOHN J. MR. III").
  const suffixes: string[] = [];
  while (
    givenTokensAll.length > 1
    && SUFFIX_TOKENS.has(stripTrailingDot(givenTokensAll[givenTokensAll.length - 1]).toUpperCase())
  ) {
    suffixes.unshift(givenTokensAll.pop() as string);
  }

  // Stripping honorifics can empty a side entirely; fall back rather than return a partial name.
  if (surnameTokens.length === 0 || givenTokensAll.length === 0) return titleCaseWithoutHonorifics(value);

  const parts = [
    titleCase(givenTokensAll.join(" ")),
    titleCase(surnameTokens.join(" ")),
    ...suffixes.map((suffix) => titleCase(stripTrailingDot(suffix))),
  ];

  return parts.filter(Boolean).join(" ");
}

/**
 * Party codes that normalizePartyLabel actually resolves. Everything else in the FEC feed --
 * LIB, DFL, NPA, GRE and a dozen more -- would come back as the raw code, so those fall through
 * to the spelled-out name instead.
 */
const MAPPED_PARTY_CODES = new Set([
  "D", "DEM", "DEMOCRAT", "DEMOCRATIC", "R", "REP", "REPUBLICAN", "I", "IND", "INDEPENDENT",
]);

/**
 * A readable party name.
 *
 * The feed carries both a code ("REP") and a spelling ("REPUBLICAN PARTY"). The code is preferred
 * where it maps, because "Republican" reads better than "Republican Party"; the spelling is the
 * fallback because "Libertarian Party" beats "LIB".
 */
export function formatParty(code?: string | null, full?: string | null) {
  const upperCode = (code || "").trim().toUpperCase();
  if (MAPPED_PARTY_CODES.has(upperCode)) return normalizePartyLabel(upperCode);

  const spelled = (full || "").trim();
  if (spelled) return titleCase(spelled);
  return upperCode || "Unknown";
}

export interface ElectionCandidateInput {
  id: string;
  fec_candidate_id: string;
  office: string;
  state: string | null;
  district: string | null;
  name: string;
  party: string | null;
  party_full: string | null;
  incumbent_challenge: string | null;
  politician_id: string | null;
  election_year: number | null;
}

export interface RaceCandidate {
  id: string;
  fecCandidateId: string;
  name: string;
  party: string;
  partyCode: string;
  /** 'I' incumbent, 'C' challenger, 'O' open seat -- the FEC's own classification. */
  standing: "incumbent" | "challenger" | "open" | "unknown";
  politicianId: string | null;
}

export interface ElectionRace {
  id: string;
  office: FederalOffice;
  officeLabel: string;
  stateCode: string;
  stateLabel: string;
  /** "" for a Senate race; "CA-12" style for the House. */
  seat: string;
  label: string;
  candidates: RaceCandidate[];
  incumbent?: RaceCandidate;
  /** No incumbent filed -- a retirement, a new seat, or a member running for something else. */
  isOpenSeat: boolean;
  /** False when the FEC row carried no district, so the seat could not be resolved. */
  districtStated: boolean;
  partiesContesting: string[];
}

function standingOf(value: string | null): RaceCandidate["standing"] {
  if (value === "I") return "incumbent";
  if (value === "C") return "challenger";
  if (value === "O") return "open";
  return "unknown";
}

/**
 * Stable, URL-safe race key: office, state, then district for the House.
 *
 * A House filing with no district gets its own "na" key rather than being folded into district 00.
 * Folding would read as an at-large seat, and most states with a blank filing (Maryland, say) have
 * no at-large seat at all -- it would invent one. Keeping it separate is redundant at worst.
 */
export function buildRaceId(office: string, state?: string | null, district?: string | null) {
  const stateCode = (state || "").trim().toUpperCase() || "XX";
  if (office === "S" || office === "P") return `${office}-${stateCode}`.toLowerCase();
  const digits = String(district ?? "").trim().replace(/\D/g, "");
  const districtKey = digits ? digits.padStart(2, "0") : "na";
  return `${office}-${stateCode}-${districtKey}`.toLowerCase();
}

export function raceHref(raceId: string) {
  return `/elections/${raceId}`;
}

function raceLabel(office: string, stateCode: string, seat: string) {
  if (office === "S") return `${normalizeStateLabel(stateCode)} — U.S. Senate`;
  if (office === "P") return "President of the United States";
  // No seat means the filing carried no district; say so rather than implying an at-large seat.
  if (!seat) return `${normalizeStateLabel(stateCode)} — U.S. House (district not stated)`;
  return `${seat} — U.S. House`;
}

/**
 * Groups filings into the seats they are contesting.
 *
 * A race is one office in one state (and, for the House, one district). Candidates are ordered
 * incumbent first, then by party and name, so a reader sees who currently holds the seat without
 * scanning.
 */
export function buildRaces(rows: ElectionCandidateInput[]): ElectionRace[] {
  const byRace = new Map<string, ElectionCandidateInput[]>();

  for (const row of rows) {
    if (!FEDERAL_OFFICES.includes(row.office as FederalOffice)) continue;
    const id = buildRaceId(row.office, row.state, row.district);
    const existing = byRace.get(id);
    if (existing) existing.push(row);
    else byRace.set(id, [row]);
  }

  const races: ElectionRace[] = [];

  for (const [id, group] of byRace) {
    const first = group[0];
    const office = first.office as FederalOffice;
    const stateCode = (first.state || "").trim().toUpperCase();
    const seat = office === "H" ? normalizeDistrictSeat(stateCode, first.district) : "";

    const candidates: RaceCandidate[] = group
      .map((row) => ({
        id: row.id,
        fecCandidateId: row.fec_candidate_id,
        name: formatCandidateName(row.name),
        party: formatParty(row.party, row.party_full),
        partyCode: (row.party || "").trim().toUpperCase(),
        standing: standingOf(row.incumbent_challenge),
        politicianId: row.politician_id,
      }))
      .sort((left, right) => {
        if (left.standing === "incumbent" && right.standing !== "incumbent") return -1;
        if (right.standing === "incumbent" && left.standing !== "incumbent") return 1;
        const byParty = left.party.localeCompare(right.party, "en-US");
        if (byParty !== 0) return byParty;
        return left.name.localeCompare(right.name, "en-US", { sensitivity: "base" });
      });

    const incumbent = candidates.find((candidate) => candidate.standing === "incumbent");

    races.push({
      id,
      office,
      officeLabel: OFFICE_LABELS[office] || office,
      stateCode,
      stateLabel: normalizeStateLabel(stateCode),
      seat,
      label: raceLabel(office, stateCode, seat),
      candidates,
      incumbent,
      isOpenSeat: !incumbent,
      districtStated: office !== "H" || Boolean(seat),
      partiesContesting: [...new Set(candidates.map((candidate) => candidate.party))].sort(),
    });
  }

  return races.sort((left, right) => {
    // Senate above House within a state: the statewide race is the headline one.
    const byState = left.stateCode.localeCompare(right.stateCode, "en-US");
    if (byState !== 0) return byState;
    if (left.office !== right.office) return left.office === "S" ? -1 : 1;
    return left.seat.localeCompare(right.seat, "en-US", { numeric: true });
  });
}

/** Days until the election, or null when the date has passed or is unknown. */
export function daysUntil(electionDate: Date, now = new Date()) {
  const ms = electionDate.getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.ceil(ms / 86_400_000);
}

/**
 * US federal general elections are the Tuesday after the first Monday in November. Computed
 * rather than hardcoded so the page does not quietly expire at the end of the cycle.
 */
export function generalElectionDate(year: number) {
  const november = new Date(Date.UTC(year, 10, 1));
  const day = november.getUTCDay();
  // First Monday, then the day after it.
  const firstMonday = 1 + ((8 - day) % 7);
  return new Date(Date.UTC(year, 10, firstMonday + 1));
}
