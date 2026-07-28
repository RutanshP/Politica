/**
 * Shared sort-direction model for every directory (politicians, bills, committees, elections).
 *
 * Each sort option has a *natural* direction -- the one a reader expects when they pick it.
 * "Attendance" means best first; "Name" means A->Z. Storing a raw asc/desc in the URL without
 * that notion would make one shared control mean opposite things per option, so direction is
 * always resolved against the option's natural order and the flip button simply asks for "the
 * other end of this list".
 */
export type SortDirection = "asc" | "desc";

/**
 * Options that read "most first". Everything else -- names, titles, identifiers, places --
 * reads A->Z. Keyed by the same display labels the directories put in their dropdowns, which
 * are distinct across directories, so one table covers all of them.
 */
const NATURALLY_DESCENDING = new Set([
  "Attendance",
  "Bills introduced",
  "Party alignment",
  "Recent activity",
  "Candidates",
  "Active bills",
  "Members",
]);

/** Naturally-descending options measured in time rather than quantity, for labelling only. */
const CHRONOLOGICAL = new Set(["Recent activity"]);

export function naturalSortDirection(sortBy: string): SortDirection {
  return NATURALLY_DESCENDING.has(sortBy) ? "desc" : "asc";
}

/** Reads the `dir` search param, falling back to the option's natural order. */
export function resolveSortDirection(sortBy: string, requested?: string): SortDirection {
  return requested === "asc" || requested === "desc" ? requested : naturalSortDirection(sortBy);
}

export function flipSortDirection(direction: SortDirection): SortDirection {
  return direction === "asc" ? "desc" : "asc";
}

/**
 * True when the direction is the option's natural one, so callers can drop `dir` from the URL
 * and keep default links clean.
 */
export function isNaturalSortDirection(sortBy: string, direction: SortDirection) {
  return direction === naturalSortDirection(sortBy);
}

/**
 * Multiplier for comparators already written in their natural order: 1 keeps them as they are,
 * -1 reverses them. Lets each directory keep its existing comparator untouched.
 */
export function sortDirectionFactor(sortBy: string, direction: SortDirection): 1 | -1 {
  return isNaturalSortDirection(sortBy, direction) ? 1 : -1;
}

/**
 * Human-readable direction for the toggle, phrased for what is actually being ordered -- dates
 * read newest/oldest, quantities read highest/lowest, text reads A->Z.
 */
export function sortDirectionLabel(sortBy: string, direction: SortDirection) {
  if (CHRONOLOGICAL.has(sortBy)) {
    return direction === "desc" ? "Newest first" : "Oldest first";
  }

  if (naturalSortDirection(sortBy) === "desc") {
    return direction === "desc" ? "Highest first" : "Lowest first";
  }

  return direction === "asc" ? "A to Z" : "Z to A";
}
