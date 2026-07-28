import { load } from "js-yaml";

const COMMITTEE_MEMBERSHIP_URL =
  process.env.POLITICA_CONGRESS_LEGISLATORS_COMMITTEE_MEMBERSHIP_URL?.trim()
  || "https://raw.githubusercontent.com/unitedstates/congress-legislators/main/committee-membership-current.yaml";

const LEGISLATORS_CURRENT_URL =
  process.env.POLITICA_CONGRESS_LEGISLATORS_CURRENT_URL?.trim()
  || "https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml";

const FETCH_TIMEOUT_MS = 20000;

export interface CongressLegislatorsCommitteeMember {
  name?: string;
  party?: string;
  rank?: number;
  title?: string;
  bioguide?: string;
}

type RawCommitteeMembership = Record<string, CongressLegislatorsCommitteeMember[]>;

/**
 * Congress.gov's own API never exposes a committee's member roster -- only a chair/ranking-member
 * name string per committee. The free, static, no-key-required unitedstates/congress-legislators
 * project publishes the real roster, keyed by the same "thomas_id" codes Congress.gov's systemCode
 * is built from: a bare code like "SSAF" is the full committee ("ssaf00"), and a code already
 * suffixed with a subcommittee number like "SSAF13" maps directly ("ssaf13").
 */
export async function fetchCongressLegislatorsCommitteeMembership() {
  const response = await fetch(COMMITTEE_MEMBERSHIP_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`congress-legislators committee membership fetch failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const parsed = (load(text) as RawCommitteeMembership) || {};

  const bySystemCode = new Map<string, CongressLegislatorsCommitteeMember[]>();
  for (const [code, members] of Object.entries(parsed)) {
    if (!Array.isArray(members)) {
      continue;
    }
    const systemCode = /^[A-Za-z]+$/.test(code) ? `${code.toLowerCase()}00` : code.toLowerCase();
    bySystemCode.set(systemCode, members);
  }

  return bySystemCode;
}

interface RawCurrentLegislator {
  id?: {
    bioguide?: string;
    fec?: string[];
  };
  terms?: RawLegislatorTerm[];
}

interface RawLegislatorTerm {
  type?: string;
  start?: string;
  end?: string;
  state?: string;
  district?: number;
  class?: number;
  /** "special-election" or "appointment" when the seat was not filled by a regular election. */
  how?: string;
  party?: string;
}

/**
 * One actual term of office, as congress-legislators records it.
 *
 * Congress.gov publishes a row per Congress, so a six-year Senate term arrives as three rows and
 * a term's real end date is never stated -- it has to be guessed from chamber and start year,
 * which goes wrong for anyone seated mid-cycle. This dataset records terms as terms, with exact
 * dates, the Senate class, and how the seat was filled.
 */
export interface CongressLegislatorTerm {
  chamber: "House" | "Senate";
  start: string;
  end: string;
  state: string | null;
  district: number | null;
  senateClass: number | null;
  /** "special-election", "appointment", or null for a regular election. */
  how: string | null;
}

/**
 * bioguide -> every term the member has served, oldest first.
 *
 * Covers sitting members only; the project keeps former members in a separate historical file
 * that is far larger and that nothing here needs.
 */
export async function fetchCongressLegislatorsTerms() {
  const response = await fetch(LEGISLATORS_CURRENT_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`congress-legislators current fetch failed: ${response.status} ${response.statusText}`);
  }

  const parsed = (load(await response.text()) as RawCurrentLegislator[]) || [];
  const termsByBioguide = new Map<string, CongressLegislatorTerm[]>();

  for (const legislator of parsed) {
    const bioguide = legislator?.id?.bioguide;
    if (!bioguide || !Array.isArray(legislator.terms)) {
      continue;
    }

    const terms: CongressLegislatorTerm[] = [];
    for (const term of legislator.terms) {
      const chamber = term.type === "sen" ? "Senate" : term.type === "rep" ? "House" : undefined;
      if (!chamber || !term.start || !term.end) {
        continue;
      }
      terms.push({
        chamber,
        start: term.start,
        end: term.end,
        state: term.state ?? null,
        district: typeof term.district === "number" ? term.district : null,
        senateClass: typeof term.class === "number" ? term.class : null,
        how: term.how ?? null,
      });
    }

    if (terms.length > 0) {
      terms.sort((left, right) => left.start.localeCompare(right.start));
      termsByBioguide.set(bioguide, terms);
    }
  }

  return termsByBioguide;
}

/**
 * bioguide -> FEC candidate ids for every current member. The FEC API has no
 * bioguide lookup, and name search is unreliable; this dataset is the standard
 * deterministic crosswalk. A member can carry several FEC ids (e.g. a House id
 * plus a Senate id after a chamber switch) -- callers pick by office prefix
 * (H/S) against the member's current title.
 */
export async function fetchCongressLegislatorsFecIds() {
  const response = await fetch(LEGISLATORS_CURRENT_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`congress-legislators current fetch failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const parsed = (load(text) as RawCurrentLegislator[]) || [];

  const fecIdsByBioguide = new Map<string, string[]>();
  for (const legislator of parsed) {
    const bioguide = legislator?.id?.bioguide;
    const fecIds = legislator?.id?.fec;
    if (bioguide && Array.isArray(fecIds) && fecIds.length > 0) {
      fecIdsByBioguide.set(bioguide, fecIds.filter((id): id is string => typeof id === "string"));
    }
  }

  return fecIdsByBioguide;
}
