/**
 * Service history and electoral outlook for a member, derived from the `terms` array Congress.gov
 * ships on every member record (stored as politicians.raw_member).
 *
 * Everything here is pure: the caller supplies the raw terms and the current year, so the whole
 * model is testable without a database or a clock.
 */

/** A term as Congress.gov publishes it. The current term carries no endYear. */
export interface RawCongressTerm {
  chamber?: string;
  congress?: number;
  startYear?: number;
  endYear?: number;
  district?: number | null;
  stateCode?: string;
  memberType?: string;
}

export type TermChamber = "House" | "Senate";

/**
 * One term of office -- six years in the Senate, two in the House.
 *
 * Congress.gov publishes a row per *Congress*, not per term, so a senator serving a single term
 * shows up as three rows. Those are grouped here; `congresses` keeps the ones this term spans.
 */
export interface TenureTerm {
  chamber: TermChamber;
  congresses: number[];
  startYear: number;
  /** Absent while the term is still being served. */
  endYear?: number;
  district: number | null;
  stateCode: string | null;
  isCurrent: boolean;
}

/** Years in a term of office, by chamber. */
export const TERM_LENGTH_YEARS: Record<TermChamber, number> = { House: 2, Senate: 6 };

export interface Tenure {
  terms: TenureTerm[];
  currentTerm?: TenureTerm;
  /** Terms served in each chamber, counting the one in progress. */
  termsByChamber: Record<TermChamber, number>;
  firstSwornYear?: number;
  /** Whole years served, summing every term and counting the current one up to `asOfYear`. */
  yearsServed: number;
  /** January of the year the current term ends -- terms end on Jan 3. */
  termEndsYear?: number;
  /** The November the seat is next contested, which is the year before the term ends. */
  nextElectionYear?: number;
  /** Every November this member won, inferred from when each term began. */
  previousElectionYears: number[];
  /** True when the seat changed chambers at some point (a House member later elected Senator). */
  switchedChambers: boolean;
}

/** Congress 1 convened in 1789 and each one runs two years. */
export function congressStartYear(congress: number) {
  return 1789 + (congress - 1) * 2;
}

function toChamber(term: RawCongressTerm): TermChamber | undefined {
  const source = `${term.chamber || ""} ${term.memberType || ""}`.toLowerCase();
  if (source.includes("senate") || source.includes("senator")) return "Senate";
  if (source.includes("house") || source.includes("representative")) return "House";
  return undefined;
}

/**
 * A Senate term runs six years, a House term two. Congress.gov leaves the current term's endYear
 * blank, so it has to be projected rather than read.
 *
 * This projects from when the term began, which is right for anyone who won the seat outright but
 * overstates a senator appointed to fill a vacancy -- they serve only the remainder of the class's
 * term. Distinguishing the two needs the Senate class, which this payload does not carry.
 */
/**
 * A term runs its full length from the year it began -- six years in the Senate, two in the House.
 *
 * Measured from the term's own start, not from the Congress currently being served: a senator
 * three Congresses into one term has not started a new one, and counting from the latest Congress
 * pushed McConnell's term, which began in 2021, out to 2031 instead of 2027.
 */
function projectedEndYear(term: TenureTerm) {
  if (term.endYear) return term.endYear;
  return term.startYear + TERM_LENGTH_YEARS[term.chamber];
}

export function buildTenure(rawTerms: RawCongressTerm[] | undefined, asOfYear: number): Tenure {
  interface CongressStint {
    chamber: TermChamber;
    congress: number;
    startYear: number;
    endYear?: number;
    district: number | null;
    stateCode: string | null;
  }

  const stints: CongressStint[] = [];
  for (const term of rawTerms ?? []) {
    const chamber = toChamber(term);
    if (!chamber || typeof term.startYear !== "number" || typeof term.congress !== "number") {
      continue;
    }

    const stint: CongressStint = {
      chamber,
      congress: term.congress,
      startYear: term.startYear,
      district: typeof term.district === "number" ? term.district : null,
      stateCode: term.stateCode ?? null,
    };
    if (typeof term.endYear === "number") {
      stint.endYear = term.endYear;
    }
    stints.push(stint);
  }
  stints.sort((left, right) => left.startYear - right.startYear || left.congress - right.congress);

  /*
   * Collapse per-Congress rows into terms of office. A run of service continues the same term
   * until it breaks -- the chamber changes, service lapses, or the term's full length has
   * elapsed since it began. Two Senate rows one Congress apart are one term, not two.
   */
  const terms: TenureTerm[] = [];
  for (const stint of stints) {
    const open = terms[terms.length - 1];
    /*
     * Terms of office begin on Jan 3 of an odd year, so a row starting in an even year is a
     * mid-cycle seating -- someone filling the rest of another member's term. When the next row
     * then starts on an odd year, that remainder is over and a term of their own begins. Schiff
     * finished Feinstein's term in 2024 before starting his own in 2025: two terms served, inside
     * what is otherwise one unbroken run of service.
     */
    const finishedSomeoneElsesTerm = open
      && open.startYear % 2 === 0
      && stint.startYear % 2 === 1;
    const contiguous = open
      && open.chamber === stint.chamber
      && !finishedSomeoneElsesTerm
      && stint.startYear <= (open.endYear ?? stint.startYear)
      && stint.startYear - open.startYear < TERM_LENGTH_YEARS[stint.chamber];

    if (open && contiguous) {
      open.congresses.push(stint.congress);
      // A district can change mid-term through redistricting; the newest one is the seat held.
      open.district = stint.district;
      open.stateCode = stint.stateCode ?? open.stateCode;
      if (typeof stint.endYear === "number") {
        open.endYear = stint.endYear;
      } else {
        delete open.endYear;
      }
      continue;
    }

    const built: TenureTerm = {
      chamber: stint.chamber,
      congresses: [stint.congress],
      startYear: stint.startYear,
      district: stint.district,
      stateCode: stint.stateCode,
      isCurrent: false,
    };
    if (typeof stint.endYear === "number") {
      built.endYear = stint.endYear;
    }
    terms.push(built);
  }

  if (terms.length === 0) {
    return {
      terms: [],
      termsByChamber: { House: 0, Senate: 0 },
      yearsServed: 0,
      previousElectionYears: [],
      switchedChambers: false,
    };
  }

  /*
   * The term in progress is the one Congress.gov left open-ended. Falling back to the latest term
   * keeps former members working -- their history is complete and none of it is open.
   */
  const openTerm = terms.find((term) => term.endYear === undefined);
  const current = openTerm ?? undefined;
  if (current) current.isCurrent = true;

  const termsByChamber = terms.reduce(
    (totals, term) => ({ ...totals, [term.chamber]: totals[term.chamber] + 1 }),
    { House: 0, Senate: 0 } as Record<TermChamber, number>,
  );

  const yearsServed = terms.reduce((total, term) => {
    const end = term.endYear ?? asOfYear;
    return total + Math.max(0, end - term.startYear);
  }, 0);

  /*
   * A term starting on Jan 3 of an odd year follows an election the previous November. A term
   * starting in an even year is a mid-cycle seating, which follows an election (or appointment)
   * in that same year. Deduplicated because one November can deliver both -- Schiff's 2024 win
   * seated him for the rest of Feinstein's term and for his own.
   */
  const previousElectionYears = [
    ...new Set(
      terms
        .filter((term) => !term.isCurrent)
        .map((term) => (term.startYear % 2 === 0 ? term.startYear : term.startYear - 1)),
    ),
  ].sort((left, right) => right - left);

  const termEndsYear = current ? projectedEndYear(current) : undefined;

  return {
    terms,
    currentTerm: current,
    termsByChamber,
    firstSwornYear: terms[0]?.startYear,
    yearsServed,
    termEndsYear,
    // Terms begin on Jan 3, so the seat is contested the November before that.
    nextElectionYear: termEndsYear ? termEndsYear - 1 : undefined,
    previousElectionYears,
    switchedChambers: termsByChamber.House > 0 && termsByChamber.Senate > 0,
  };
}

/** A term as congress-legislators records it: real terms, exact dates. See OfficialTerm below. */
export interface OfficialTerm {
  chamber: TermChamber;
  start: string;
  end: string;
  state: string | null;
  district: number | null;
  senateClass: number | null;
  how: string | null;
}

function yearOf(isoDate: string) {
  return Number.parseInt(isoDate.slice(0, 4), 10);
}

/**
 * Tenure built from recorded terms rather than inferred from per-Congress rows.
 *
 * Nothing is projected here: each term already carries its real end date, so a member seated
 * mid-cycle to finish someone else's term gets that term's true expiry instead of six years from
 * when they arrived. `how` distinguishes a seat won at a special election or filled by
 * appointment from one won at a regular election, which is what decides when the election behind
 * a term actually happened.
 */
export function buildTenureFromOfficialTerms(officialTerms: OfficialTerm[], asOfYear: number): Tenure {
  const ordered = [...officialTerms].sort((left, right) => left.start.localeCompare(right.start));

  const terms: TenureTerm[] = ordered.map((term) => {
    const startYear = yearOf(term.start);
    const endYear = yearOf(term.end);
    const built: TenureTerm = {
      chamber: term.chamber,
      congresses: [],
      startYear,
      district: term.district,
      stateCode: term.state,
      isCurrent: endYear > asOfYear,
    };
    built.endYear = endYear;
    return built;
  });

  if (terms.length === 0) {
    return {
      terms: [],
      termsByChamber: { House: 0, Senate: 0 },
      yearsServed: 0,
      previousElectionYears: [],
      switchedChambers: false,
    };
  }

  // Only the last term can still be running; anything earlier has been superseded.
  for (let index = 0; index < terms.length - 1; index += 1) {
    terms[index]!.isCurrent = false;
  }
  const current = terms[terms.length - 1]!.isCurrent ? terms[terms.length - 1] : undefined;

  const termsByChamber = terms.reduce(
    (totals, term) => ({ ...totals, [term.chamber]: totals[term.chamber] + 1 }),
    { House: 0, Senate: 0 } as Record<TermChamber, number>,
  );

  const yearsServed = terms.reduce((total, term) => {
    const end = Math.min(term.endYear ?? asOfYear, asOfYear);
    return total + Math.max(0, end - term.startYear);
  }, 0);

  /*
   * A term won at a regular election began the January after that November. A seat filled by
   * special election was won in the year the member took it, and one filled by appointment was
   * never won at all, so it contributes no election.
   */
  const previousElectionYears = [
    ...new Set(
      ordered
        .map((term, index) => ({ term, isCurrent: terms[index]!.isCurrent }))
        .filter(({ term, isCurrent }) => !isCurrent && term.how !== "appointment")
        .map(({ term }) =>
          term.how === "special-election" ? yearOf(term.start) : yearOf(term.start) - 1),
    ),
  ].sort((left, right) => right - left);

  const termEndsYear = current?.endYear;

  return {
    terms,
    ...(current ? { currentTerm: current } : {}),
    termsByChamber,
    firstSwornYear: terms[0]?.startYear,
    yearsServed,
    ...(termEndsYear ? { termEndsYear, nextElectionYear: termEndsYear - 1 } : {}),
    previousElectionYears,
    switchedChambers: termsByChamber.House > 0 && termsByChamber.Senate > 0,
  };
}

export type ReelectionFilingStatus = "filed" | "inactive" | "not-filed" | "unknown";

/**
 * What the FEC candidate record says about running again.
 *
 * This reports the filing record rather than declaring intent. Absence of a filing is not proof
 * of retirement -- deadlines vary by state and candidates file at their own pace -- and it is
 * only meaningful at all for a cycle the sync actually covers. An FEC candidacy the commission
 * has marked inactive is the strongest retirement signal available here, and is worth separating
 * from never having filed.
 */
export function describeReelectionFiling(status: ReelectionFilingStatus, cycle?: number) {
  if (status === "filed") {
    return {
      label: cycle ? `Filed for ${cycle}` : "Filed to run again",
      detail: "An active FEC candidacy is on record for this cycle.",
      tone: "emerald" as const,
    };
  }

  if (status === "inactive") {
    return {
      label: cycle ? `${cycle} filing inactive` : "Filing inactive",
      detail:
        "An FEC candidacy exists for this cycle but the commission has flagged it inactive -- typically a member who is not seeking reelection.",
      tone: "rose" as const,
    };
  }

  if (status === "not-filed") {
    return {
      label: cycle ? `No ${cycle} filing` : "No filing on record",
      detail:
        "No FEC candidacy is on record for this cycle. Filing deadlines vary by state, so this is not a declaration of retirement.",
      tone: "amber" as const,
    };
  }

  return {
    label: "Filing status not known",
    detail:
      "The FEC candidate sync does not cover this cycle yet, so nothing can be said either way about running again.",
    tone: "slate" as const,
  };
}
