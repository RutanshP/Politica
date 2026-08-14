import "server-only";

import { isSenateElectronicReport, parseSenateTransactions, type DisclosedTransaction } from "@/lib/stock-disclosures";

/**
 * Senate financial disclosures, from efdsearch.senate.gov.
 *
 * There is no API. The site is a Django app that requires a session: a CSRF token from the landing
 * page, then a POST accepting the prohibition-on-redistribution notice, after which a DataTables
 * endpoint returns filings as JSON. All three steps share one cookie jar, which is why this module
 * threads a session object through rather than issuing independent fetches.
 *
 * The payoff is that electronically filed reports are HTML tables, not PDFs -- ticker and amount
 * arrive in their own cells and need no positional extraction at all.
 */

const BASE = "https://efdsearch.senate.gov";
const HOME = `${BASE}/search/home/`;
const SEARCH_DATA = `${BASE}/search/report/data/`;

/** Report type 11 is the periodic transaction report. */
const REPORT_TYPE_PTR = 11;

const USER_AGENT = "Politica civic-data (contact: rutansh.pathak@gmail.com)";

export interface SenateSession {
  cookie: string;
  csrfToken: string;
}

export interface SenateFilingRow {
  firstName: string;
  lastName: string;
  /** As printed, e.g. "Fetterman, John (Senator)". */
  filerLabel: string;
  reportLabel: string;
  reportUrl: string;
  filedOn: string | null;
  /** False for scans of paper filings, which have no table to parse. */
  electronic: boolean;
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function absorbCookies(jar: Map<string, string>, response: Response) {
  // getSetCookie() keeps multiple Set-Cookie headers separate; reading the joined header would
  // split a cookie value containing a comma.
  const headers = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const raw of headers) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

function extractCsrf(html: string) {
  const match = html.match(/name=['"]csrfmiddlewaretoken['"]\s+value=['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

/**
 * Opens a session: fetch the landing page for a token, then accept the notice.
 *
 * Without the acceptance POST every search returns a redirect to the notice page, which reads as an
 * empty result rather than an error -- the exact failure that makes this look like "the Senate has
 * no filings" instead of "the session was never established".
 */
export async function openSenateSession(): Promise<SenateSession> {
  const jar = new Map<string, string>();

  const landing = await fetch(HOME, {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (!landing.ok) throw new Error(`Senate EFD landing page failed: ${landing.status}`);
  absorbCookies(jar, landing);

  const formToken = extractCsrf(await landing.text());
  if (!formToken) throw new Error("Senate EFD landing page carried no CSRF token");

  const accept = await fetch(HOME, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: HOME,
      Cookie: cookieHeader(jar),
    },
    body: new URLSearchParams({ csrfmiddlewaretoken: formToken, prohibition_agreement: "1" }).toString(),
    redirect: "manual",
    cache: "no-store",
  });
  absorbCookies(jar, accept);

  const csrfToken = jar.get("csrftoken");
  if (!csrfToken) throw new Error("Senate EFD did not issue a session cookie");

  return { cookie: cookieHeader(jar), csrfToken };
}

interface SearchResponse {
  recordsTotal?: number;
  data?: string[][];
}

/**
 * One page of transaction-report search results.
 *
 * The endpoint caps `length` at 100 regardless of what is asked for, so the caller pages.
 */
export async function fetchSenateFilingPage(
  session: SenateSession,
  input: { start: number; length?: number; since?: string },
): Promise<{ rows: SenateFilingRow[]; total: number }> {
  const body = new URLSearchParams({
    csrfmiddlewaretoken: session.csrfToken,
    start: String(input.start),
    length: String(Math.min(input.length ?? 100, 100)),
    report_types: `[${REPORT_TYPE_PTR}]`,
    filer_types: "[]",
    submitted_start_date: input.since || "01/01/2012 00:00:00",
    submitted_end_date: "",
    candidate_state: "",
    senator_state: "",
    office_id: "",
    first_name: "",
    last_name: "",
  });

  const response = await fetch(SEARCH_DATA, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${BASE}/search/`,
      Cookie: session.cookie,
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`Senate EFD search failed: ${response.status}`);

  const payload = (await response.json()) as SearchResponse;
  const rows: SenateFilingRow[] = [];

  for (const cells of payload.data || []) {
    if (cells.length < 5) continue;

    const linkCell = cells[3] || "";
    const href = linkCell.match(/href="([^"]+)"/)?.[1] || "";
    if (!href) continue;

    rows.push({
      firstName: (cells[0] || "").trim(),
      lastName: (cells[1] || "").trim(),
      filerLabel: (cells[2] || "").trim(),
      reportLabel: linkCell.replace(/<[^>]*>/g, "").trim(),
      reportUrl: href.startsWith("http") ? href : `${BASE}${href}`,
      filedOn: normalizeFiledOn(cells[4]),
      electronic: isSenateElectronicReport(href),
    });
  }

  return { rows, total: Number(payload.recordsTotal) || rows.length };
}

function normalizeFiledOn(raw: string | undefined) {
  const match = (raw || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
}

/** Every transaction report since `since`, paged. */
export async function fetchAllSenateFilings(
  session: SenateSession,
  options?: { since?: string; maxPages?: number },
): Promise<SenateFilingRow[]> {
  const rows: SenateFilingRow[] = [];
  const maxPages = options?.maxPages ?? 40;

  for (let page = 0; page < maxPages; page += 1) {
    const { rows: pageRows, total } = await fetchSenateFilingPage(session, {
      start: page * 100,
      length: 100,
      since: options?.since,
    });

    rows.push(...pageRows);
    if (pageRows.length === 0 || rows.length >= total) break;
  }

  return rows;
}

/**
 * Transactions on one report.
 *
 * A paper filing returns no table and yields an empty array; that is a real outcome, not an error,
 * and the caller records it as `scanned` rather than as a member with nothing to disclose.
 */
export async function fetchSenateReportTransactions(
  session: SenateSession,
  reportUrl: string,
): Promise<DisclosedTransaction[]> {
  const response = await fetch(reportUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: `${BASE}/search/`,
      Cookie: session.cookie,
    },
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`Senate report fetch failed: ${response.status}`);

  return parseSenateTransactions(await response.text());
}
