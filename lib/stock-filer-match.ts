import { normalizePersonLookup } from "@/lib/utils";

/**
 * Resolving a disclosure filer to a stored member.
 *
 * The two chambers name people differently and neither publishes an identifier: the House index has
 * "Aderholt / Robert B. / AL04", the Senate search has "Fetterman, John (Senator)". Both have to
 * land on the same bioguide ID the rest of the app keys on.
 *
 * The reason this matters beyond tidiness is cross-chamber careers. 43 sitting members served in the
 * House first, and their House-era filings are indexed under a district that no longer describes
 * them. Matching on name with state as a tiebreaker -- rather than on chamber or district -- is what
 * keeps those years attached to the same person instead of splitting a career in half at the point
 * they changed office.
 */

export interface MatchableMember {
  id: string;
  name: string;
  /** Two-letter code. Used only to break ties between members who share a surname. */
  state?: string | null;
  /** The member's current chamber, used only as a tiebreaker -- never as a filter. */
  chamber?: "house" | "senate" | null;
}

export interface FilerIdentity {
  first: string;
  last: string;
  /** "AL04" from the House index, or a bare state code. Optional -- the Senate gives neither. */
  stateDistrict?: string | null;
  /**
   * Which chamber's system this filing came from.
   *
   * A tiebreaker only. It cannot be a filter, because the whole point of this matcher is that a
   * member's House-era filings must still reach them after they move to the Senate.
   */
  chamber?: "house" | "senate" | null;
}

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * Familiar forms, because the two sides of this match disagree on them constantly.
 *
 * A disclosure is filed under a legal name while the roster carries the name the member goes by --
 * "Michael A. Collins" against "Mike Collins", "William" against "Bill". Neither equality nor a
 * prefix test resolves those ("michael" does not start with "mike"), so the common pairs are listed.
 * Each entry maps to a shared canonical form; the direction does not matter.
 */
const NICKNAMES: Record<string, string> = {
  mike: "michael", mick: "michael",
  bill: "william", will: "william", billy: "william",
  bob: "robert", rob: "robert", bobby: "robert",
  dick: "richard", rick: "richard", ricky: "richard", rich: "richard",
  jim: "james", jimmy: "james",
  joe: "joseph",
  dan: "daniel", danny: "daniel",
  tom: "thomas", tommy: "thomas",
  steve: "stephen", steven: "stephen",
  chris: "christopher",
  tim: "timothy",
  matt: "matthew",
  nick: "nicholas",
  ben: "benjamin",
  sam: "samuel",
  dave: "david",
  greg: "gregory",
  jeff: "jeffrey", jeffery: "jeffrey",
  andy: "andrew", drew: "andrew",
  ed: "edward", eddie: "edward", ted: "edward",
  doug: "douglas",
  ron: "ronald",
  don: "donald",
  pat: "patrick",
  tony: "anthony",
  vince: "vincent",
  ken: "kenneth",
  larry: "lawrence",
  gus: "augustus",
  hal: "harold",
  kate: "katherine", katie: "katherine", kathy: "katherine", cathy: "catherine",
  liz: "elizabeth", beth: "elizabeth", betty: "elizabeth",
  debbie: "deborah", deb: "deborah",
  sue: "susan", suzy: "susan",
  peggy: "margaret", maggie: "margaret",
  nancy: "ann", nan: "ann",
  jenny: "jennifer", jen: "jennifer",
  becky: "rebecca",
  cindy: "cynthia",
  sandy: "sandra",
  vicky: "victoria", vicki: "victoria",
};

/** A given name reduced to its canonical form, so familiar and legal spellings compare equal. */
function canonicalGiven(word: string) {
  return NICKNAMES[word] || word;
}

/**
 * Given name, surname and suffix, stripped of the honorifics and initials that differ per source.
 *
 * Parenthesised text is removed first. Some roster rows carry a disambiguating state in the name --
 * "Greene (GA)" -- and normalizePersonLookup only strips the brackets, leaving "greene ga" whose
 * last word is the state. That put those members in the index under "ga" instead of their surname,
 * so none of their filings could ever match.
 */
function nameParts(value: string) {
  const withoutParentheticals = (value || "").replace(/\([^)]*\)/g, " ");
  const words = normalizePersonLookup(withoutParentheticals).split(" ").filter(Boolean);
  return words.filter((word) => !SUFFIXES.has(word));
}

/** Surname, which is the stable half of a name across every source here. */
export function filerSurname(identity: FilerIdentity) {
  const parts = nameParts(identity.last);
  return parts[parts.length - 1] || "";
}

/**
 * Whether two given names can be the same person.
 *
 * Sources disagree constantly on this half: "Robert B." against "Robert", "A. Mitchell Jr." against
 * "Mitch", "Katherine M." against "Kat". Requiring equality would drop real matches, so an initial
 * or a prefix counts -- the surname and state carry the identification, and this only has to avoid
 * merging two different people who share both.
 */
export function givenNamesAgree(left: string, right: string) {
  const a = nameParts(left);
  const b = nameParts(right);
  if (a.length === 0 || b.length === 0) return false;

  const first = a[0];
  const other = b[0];

  if (first === other) return true;
  // A single initial against a full name, in either direction.
  if (first.length === 1 && other.startsWith(first)) return true;
  if (other.length === 1 && first.startsWith(other)) return true;
  // "Mike" against "Michael": a familiar form the roster and the filing disagree on.
  if (canonicalGiven(first) === canonicalGiven(other)) return true;
  // "Mitchell" inside "A. Mitchell": the given name can appear anywhere in the other's parts.
  if (a.includes(other) || b.includes(first)) return true;
  // The same, allowing for a familiar form in a middle position ("Hon. A. Mitchell" vs "Mitch").
  if (a.some((word) => canonicalGiven(word) === canonicalGiven(other))) return true;
  if (b.some((word) => canonicalGiven(word) === canonicalGiven(first))) return true;

  return false;
}

/** The two-letter state from "AL04", "AL", or empty. */
export function stateFromDistrict(stateDistrict: string | null | undefined) {
  const match = (stateDistrict || "").trim().toUpperCase().match(/^([A-Z]{2})/);
  return match ? match[1] : null;
}

/**
 * An index of stored members, built once per sync rather than per filing.
 *
 * Keyed on surname because that is what survives every spelling difference; candidates sharing a
 * surname are then separated by given name and state.
 */
export function buildFilerIndex(members: MatchableMember[]) {
  const bySurname = new Map<string, MatchableMember[]>();

  for (const member of members) {
    const parts = nameParts(member.name);
    const surname = parts[parts.length - 1];
    if (!surname) continue;
    bySurname.set(surname, [...(bySurname.get(surname) ?? []), member]);
  }

  return bySurname;
}

/**
 * The member who filed this disclosure, or null.
 *
 * Returns null rather than guessing when two members with the same surname and compatible given
 * names cannot be separated -- attributing someone's trades to the wrong person is worse than
 * leaving the filing unmatched, and unmatched filings are stored with that status so the count is
 * visible instead of silently absorbed.
 */
export function matchFiler(
  index: Map<string, MatchableMember[]>,
  identity: FilerIdentity,
): MatchableMember | null {
  const surname = filerSurname(identity);
  if (!surname) return null;

  const candidates = index.get(surname);
  if (!candidates || candidates.length === 0) return null;

  const byGivenName = candidates.filter((candidate) => {
    const parts = nameParts(candidate.name);
    // Everything before the surname is the given-name side.
    const given = parts.slice(0, -1).join(" ") || parts[0] || "";
    return givenNamesAgree(given, identity.first);
  });

  if (byGivenName.length === 1) return byGivenName[0];

  // No given name agreed. The surname alone settles it when only one member has it; otherwise fall
  // through to the tiebreakers, because this is exactly the case where the filing uses a legal name
  // the roster does not carry -- "Rafael E Cruz" for Ted Cruz.
  const pool = byGivenName.length > 0 ? byGivenName : candidates;
  if (pool.length === 1) return pool[0];

  const narrowed = narrow(pool, identity);
  return narrowed.length === 1 ? narrowed[0] : null;
}

/**
 * Applies state and then chamber, stopping as soon as one member is left.
 *
 * Chamber separates people that state cannot: Ted Cruz and Monica De La Cruz share a surname and a
 * state, and only one of them sits in the chamber the filing came from.
 */
function narrow(candidates: MatchableMember[], identity: FilerIdentity) {
  let pool = candidates;

  const state = stateFromDistrict(identity.stateDistrict);
  if (state) {
    const byState = pool.filter((candidate) => (candidate.state || "").toUpperCase() === state);
    if (byState.length === 1) return byState;
    if (byState.length > 1) pool = byState;
  }

  if (identity.chamber) {
    const byChamber = pool.filter((candidate) => candidate.chamber === identity.chamber);
    if (byChamber.length === 1) return byChamber;
  }

  return pool;
}
