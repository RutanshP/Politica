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

export interface TenureTerm {
  chamber: TermChamber;
  congress: number;
  startYear: number;
  /** Absent while the term is still being served. */
  endYear?: number;
  district: number | null;
  stateCode: string | null;
  isCurrent: boolean;
}

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
function projectedEndYear(term: TenureTerm) {
  if (term.endYear) return term.endYear;
  return term.chamber === "Senate" ? term.startYear + 6 : congressStartYear(term.congress) + 2;
}

export function buildTenure(rawTerms: RawCongressTerm[] | undefined, asOfYear: number): Tenure {
  const terms: TenureTerm[] = [];
  for (const term of rawTerms ?? []) {
    const chamber = toChamber(term);
    if (!chamber || typeof term.startYear !== "number" || typeof term.congress !== "number") {
      continue;
    }

    const built: TenureTerm = {
      chamber,
      congress: term.congress,
      startYear: term.startYear,
      district: typeof term.district === "number" ? term.district : null,
      stateCode: term.stateCode ?? null,
      isCurrent: false,
    };
    if (typeof term.endYear === "number") {
      built.endYear = term.endYear;
    }
    terms.push(built);
  }
  terms.sort((left, right) => left.startYear - right.startYear || left.congress - right.congress);

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
   * A term beginning in January means an election the previous November. Terms that begin because
   * of an appointment have no election behind them, but the payload cannot tell them apart, so
   * these read as "seated" years rather than certified wins.
   */
  const previousElectionYears = [
    ...new Set(terms.filter((term) => !term.isCurrent).map((term) => term.startYear - 1)),
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
