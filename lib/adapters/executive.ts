import "server-only";

/**
 * The executive branch: President and Vice President federally, governors by state.
 *
 * Two sources, because no single one covers both. Presidents and VPs come from
 * unitedstates/congress-legislators -- the same project as the congressional roster we already
 * sync, so the shape and the bioguide ids are already familiar. Governors come from OpenStates,
 * which files them under org_classification=executive.
 */

const EXECUTIVE_URL = "https://unitedstates.github.io/congress-legislators/executive.json";

export interface ExecutiveTerm {
  type?: string;
  start?: string;
  end?: string;
  party?: string;
  how?: string;
}

export interface ExecutiveRecord {
  name?: { first?: string; last?: string; official_full?: string; nickname?: string };
  bio?: { birthday?: string; gender?: string };
  id?: { bioguide?: string; wikipedia?: string; govtrack?: number };
  terms?: ExecutiveTerm[];
}

/** Everyone who has held the presidency or vice presidency, with their terms. 80 entries. */
export async function fetchExecutiveRecords(): Promise<ExecutiveRecord[]> {
  const response = await fetch(EXECUTIVE_URL, {
    headers: { Accept: "application/json", "User-Agent": "Politica/1.0 (civic data viewer)" },
    // Changes at most twice per presidential term; a long revalidate is generous.
    next: { revalidate: 86_400 },
  });
  if (!response.ok) throw new Error(`Executive roster fetch failed: ${response.status}`);

  const payload: unknown = await response.json();
  return Array.isArray(payload) ? (payload as ExecutiveRecord[]) : [];
}

/**
 * The term in force today, or undefined for a former officeholder.
 *
 * Dates are compared as plain YYYY-MM-DD strings rather than parsed. They are date-only, so
 * `new Date` would read them as UTC midnight and shift the boundary by a timezone -- the same trap
 * that produced 4,199 duplicate bill actions. Lexical comparison on a fixed-width format is exact.
 */
export function currentTerm(record: ExecutiveRecord, today = new Date().toISOString().slice(0, 10)) {
  return (record.terms ?? []).find((term) =>
    Boolean(term.start) && term.start! <= today && (!term.end || term.end > today));
}

export function displayName(record: ExecutiveRecord) {
  const name = record.name ?? {};
  return name.official_full
    || [name.nickname || name.first, name.last].filter(Boolean).join(" ").trim()
    || "Unknown";
}

export interface CurrentExecutive {
  record: ExecutiveRecord;
  term: ExecutiveTerm;
  office: "President" | "Vice President";
}

/** Whoever holds each office right now. */
export function currentExecutives(records: ExecutiveRecord[], today?: string): CurrentExecutive[] {
  const out: CurrentExecutive[] = [];

  for (const record of records) {
    const term = currentTerm(record, today);
    if (!term) continue;

    // "prez" and "viceprez" are this dataset's own type codes.
    const office = term.type === "prez" ? "President" : term.type === "viceprez" ? "Vice President" : null;
    if (!office) continue;

    out.push({ record, term, office });
  }

  return out;
}
