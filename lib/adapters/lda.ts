import "server-only";

import { congressForYear, extractBillMentions, isQuarterlyReport } from "@/lib/lobbying/lda-text";
import { organizationKey } from "@/lib/organization-names";

/**
 * Lobbying Disclosure Act filings.
 *
 * lda.gov and lda.senate.gov currently serve the same database over the same paths; lda.gov is
 * the destination of the announced migration and is what its own pagination links point at, so it
 * is the default. Override with POLITICA_LDA_API_BASE_URL if the migration moves again.
 *
 * The API works unauthenticated but is throttled hard; a key raises the limit. Unknown query
 * parameters are silently ignored rather than rejected, so filters must be spelled exactly --
 * `ordering` in particular is accepted and then ignored, which is why this pages through
 * everything instead of asking for the largest filings first.
 */

const DEFAULT_BASE_URL = "https://lda.gov/api/v1";

/** The API caps page_size at 25 regardless of what is requested. */
export const LDA_PAGE_SIZE = 25;

export interface LdaFilingRecord {
  filing_uuid: string;
  filing_year: number;
  filing_type?: string | null;
  filing_period?: string | null;
  filing_document_url?: string | null;
  income?: string | null;
  expenses?: string | null;
  dt_posted?: string | null;
  registrant?: { id?: number | string | null; name?: string | null } | null;
  client?: { id?: number | string | null; name?: string | null } | null;
  lobbying_activities?: Array<{ general_issue_code?: string | null; description?: string | null }> | null;
}

interface LdaPage<T> {
  count: number;
  next: string | null;
  results: T[];
}

function getBaseUrl() {
  return (process.env.POLITICA_LDA_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
}

export function isLdaConfigured() {
  return Boolean(process.env.POLITICA_LDA_API_KEY?.trim());
}

function buildHeaders() {
  const key = process.env.POLITICA_LDA_API_KEY?.trim();
  return {
    Accept: "application/json",
    // Django REST Framework token auth. A malformed key returns 401 rather than degrading to
    // anonymous access, so a bad value fails loudly instead of silently rate-limiting the sync.
    ...(key ? { Authorization: `Token ${key}` } : {}),
  };
}

/*
 * The throttle is a rate over a window, not a per-burst limit, so retrying alone is not enough:
 * several workers backing off in lockstep just collide again. Requests are spaced by their *start*
 * times through one shared schedule. Spacing them by completion instead (the first version) made
 * the walk fully serial -- each page takes ~2s to answer, so a 190k-report backfill was ~7 hours.
 * At the default 1000ms the rate is 60 a minute; at 700ms (85 a minute) the API began throttling.
 */
const MIN_REQUEST_INTERVAL_MS = Number(process.env.POLITICA_LDA_MIN_INTERVAL_MS || 1000);
let nextSlot = 0;

async function paced<T>(work: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_REQUEST_INTERVAL_MS;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
  return work();
}

/**
 * One page of filings posted after a moment, oldest first. The API returns these in posting order,
 * so new filings only ever append at the end: page N stays page N while a walk is in progress,
 * which is what makes the posted-after cursor resumable where paging by year was not.
 */
export async function fetchLdaFilingsPage(options: { postedAfter: string; postedBefore?: string; page: number }): Promise<LdaPage<LdaFilingRecord>> {
  return paced(() => fetchLdaFilingsPageUncontrolled(options));
}

async function fetchLdaFilingsPageUncontrolled(options: { postedAfter: string; postedBefore?: string; page: number }): Promise<LdaPage<LdaFilingRecord>> {
  const url = new URL(`${getBaseUrl()}/filings/`);
  url.searchParams.set("filing_dt_posted_after", options.postedAfter);
  if (options.postedBefore) url.searchParams.set("filing_dt_posted_before", options.postedBefore);
  url.searchParams.set("page", String(options.page));
  url.searchParams.set("page_size", String(LDA_PAGE_SIZE));

  const response = await fetch(url, { headers: buildHeaders(), cache: "no-store" });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");

    if (response.status === 429) {
      throw new LdaThrottledError(
        `LDA throttled: ${detail.slice(0, 200)}`,
        parseRetryAfterMs(response, detail),
      );
    }

    throw new Error(
      `LDA request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail.slice(0, 200)}` : ""}`,
    );
  }

  return (await response.json()) as LdaPage<LdaFilingRecord>;
}

/**
 * Sustained paging trips a throttle that a short burst does not -- 20 rapid requests all
 * succeeded while a few hundred did not. The response carries how long to wait, so honour it
 * rather than guessing with a fixed backoff.
 */
export class LdaThrottledError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "LdaThrottledError";
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfterMs(response: Response, body: string) {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) {
    return header * 1000;
  }

  // e.g. {"detail":"Request was throttled. Expected available in 3 seconds."}
  const match = body.match(/available in (\d+)\s*second/i);
  const seconds = match ? Number(match[1]) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? (seconds + 1) * 1000 : 5000;
}

function toAmount(value?: string | null) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toId(value?: number | string | null) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

export interface NormalizedLdaFiling {
  filing_uuid: string;
  filing_year: number;
  filing_type: string | null;
  filing_period: string | null;
  registrant_id: string | null;
  registrant_name: string | null;
  client_id: string | null;
  client_name: string | null;
  client_key: string;
  is_in_house: boolean;
  income: number | null;
  expenses: number | null;
  amount: number | null;
  posted_at: string | null;
  issue_codes: string[];
}

export interface NormalizedLdaReport {
  filing: NormalizedLdaFiling;
  /** Bill ids cited in the report's activity descriptions, before checking they are stored. */
  billMentions: string[];
}

/**
 * One quarterly report, normalized. Registrations and anything outside a quarter return null --
 * they carry no money or activity.
 */
export function normalizeLdaFiling(record: LdaFilingRecord): NormalizedLdaReport | null {
  if (!record?.filing_uuid || !isQuarterlyReport(record.filing_type, record.filing_period)) return null;

  const income = toAmount(record.income);
  const expenses = toAmount(record.expenses);
  const registrantName = record.registrant?.name?.trim() || null;
  const clientName = record.client?.name?.trim() || null;
  const clientKey = organizationKey(clientName);

  /*
   * A lobbying firm reports the income a client paid it; an organization lobbying for itself
   * reports its own expenses instead. So an expenses-only report is in-house whatever the names
   * say, and matching names catch the rest (the "no activity" variants report neither figure).
   * Ids cannot be compared: registrants and clients live in separate id spaces -- LEGO Systems
   * files as registrant 401107919 and client 57269.
   */
  const isInHouse = (expenses !== null && income === null)
    || Boolean(clientKey && organizationKey(registrantName) === clientKey);

  const activities = record.lobbying_activities ?? [];
  const congress = congressForYear(record.filing_year);
  const billMentions = new Set<string>();
  for (const activity of activities) {
    for (const billId of extractBillMentions(activity.description, congress)) billMentions.add(billId);
  }

  return {
    filing: {
      filing_uuid: record.filing_uuid,
      filing_year: record.filing_year,
      filing_type: record.filing_type || null,
      filing_period: record.filing_period || null,
      registrant_id: toId(record.registrant?.id),
      registrant_name: registrantName,
      client_id: toId(record.client?.id),
      client_name: clientName,
      client_key: clientKey,
      is_in_house: isInHouse,
      income,
      expenses,
      amount: isInHouse ? expenses ?? income : income ?? expenses,
      posted_at: record.dt_posted || null,
      issue_codes: [...new Set(activities.map((activity) => activity.general_issue_code).filter((code): code is string => Boolean(code)))],
    },
    billMentions: [...billMentions],
  };
}
