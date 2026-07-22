import "server-only";

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

/** Quarterly reports carry the money. Registrations and "no activity" variants do not. */
export const LDA_MONEY_FILING_TYPES = ["Q1", "Q2", "Q3", "Q4"] as const;

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
 * several workers backing off in lockstep just collide again. Requests are paced through a single
 * chained promise, the same approach the OpenStates adapter uses.
 */
const MIN_REQUEST_INTERVAL_MS = Number(process.env.POLITICA_LDA_MIN_INTERVAL_MS || 1200);
let requestChain: Promise<unknown> = Promise.resolve();

function paced<T>(work: () => Promise<T>): Promise<T> {
  const result = requestChain.then(work, work);
  requestChain = result
    .then(
      () => new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS)),
      () => new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS)),
    );
  return result;
}

export async function fetchLdaFilingsPage(options: {
  year: number;
  filingType?: string;
  page: number;
}): Promise<LdaPage<LdaFilingRecord>> {
  return paced(() => fetchLdaFilingsPageUncontrolled(options));
}

async function fetchLdaFilingsPageUncontrolled(options: {
  year: number;
  filingType?: string;
  page: number;
}): Promise<LdaPage<LdaFilingRecord>> {
  const url = new URL(`${getBaseUrl()}/filings/`);
  url.searchParams.set("filing_year", String(options.year));
  url.searchParams.set("page", String(options.page));
  url.searchParams.set("page_size", String(LDA_PAGE_SIZE));
  if (options.filingType) {
    url.searchParams.set("filing_type", options.filingType);
  }

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
  is_in_house: boolean;
  income: number | null;
  expenses: number | null;
  amount: number | null;
  posted_at: string | null;
  filing_url: string | null;
}

export function normalizeLdaFiling(record: LdaFilingRecord): NormalizedLdaFiling | null {
  if (!record?.filing_uuid) return null;

  const registrantId = toId(record.registrant?.id);
  const clientId = toId(record.client?.id);
  const income = toAmount(record.income);
  const expenses = toAmount(record.expenses);

  /*
   * A lobbying firm reports the income a client paid it. An organization lobbying for itself
   * files as its own registrant and reports expenses instead, leaving income null -- so taking
   * income alone would drop every in-house filer's money entirely.
   *
   * In-house is detected by name, not id: registrants and clients live in separate id spaces
   * (LEGO Systems files as registrant 401107919 and client 57269 -- plainly itself, yet the ids
   * differ), so comparing ids would mark nothing as in-house.
   */
  const registrantName = record.registrant?.name?.trim() || null;
  const clientName = record.client?.name?.trim() || null;
  const isInHouse = Boolean(
    registrantName
      && clientName
      && registrantName.toLowerCase() === clientName.toLowerCase(),
  );

  return {
    filing_uuid: record.filing_uuid,
    filing_year: record.filing_year,
    filing_type: record.filing_type || null,
    filing_period: record.filing_period || null,
    registrant_id: registrantId,
    registrant_name: registrantName,
    client_id: clientId,
    client_name: clientName,
    is_in_house: isInHouse,
    income,
    expenses,
    amount: income ?? expenses,
    posted_at: record.dt_posted || null,
    filing_url: record.filing_document_url || null,
  };
}
