import type {
  CongressBillActionPayload,
  CongressBillDetailPayload,
  CongressBillListItem,
  CongressBillSummaryPayload,
  CongressCommitteeDetailPayload,
  CongressCommitteeListItem,
  CongressMemberDetailPayload,
  CongressMemberListItem,
  CongressMemberSponsoredLegislationItem,
  CongressMemberSponsoredLegislationPayload,
  CongressBillTextPayload,
} from "@/types/congress";

const CONGRESS_API_BASE = process.env.POLITICA_CONGRESS_API_BASE_URL?.trim()
  || "https://api.congress.gov/v3";
const CONGRESS_FETCH_TIMEOUT_MS = Number.parseInt(
  process.env.POLITICA_CONGRESS_FETCH_TIMEOUT_MS?.trim() || "20000",
  10,
);
const CONGRESS_MEMBER_DETAIL_FETCH_TIMEOUT_MS = Number.parseInt(
  process.env.POLITICA_CONGRESS_MEMBER_FETCH_TIMEOUT_MS?.trim() || "5000",
  10,
);
const CONGRESS_FETCH_RETRY_ATTEMPTS = Number.parseInt(
  process.env.POLITICA_CONGRESS_FETCH_RETRY_ATTEMPTS?.trim() || "3",
  10,
);
const CONGRESS_MEMBER_DETAIL_FETCH_RETRY_ATTEMPTS = Number.parseInt(
  process.env.POLITICA_CONGRESS_MEMBER_FETCH_RETRY_ATTEMPTS?.trim() || "1",
  10,
);
const CONGRESS_FETCH_RETRY_BASE_DELAY_MS = Number.parseInt(
  process.env.POLITICA_CONGRESS_FETCH_RETRY_BASE_DELAY_MS?.trim() || "750",
  10,
);
const CONGRESS_FETCH_RETRY_MAX_DELAY_MS = Number.parseInt(
  process.env.POLITICA_CONGRESS_FETCH_RETRY_MAX_DELAY_MS?.trim() || "5000",
  10,
);

function getCongressApiKey() {
  return process.env.CONGRESS_API_KEY?.trim()
    || process.env.POLITICA_CONGRESS_API_KEY?.trim()
    || "";
}

export function isCongressBillsConfigured() {
  return Boolean(getCongressApiKey() && getDefaultCongress());
}

export function getDefaultCongress() {
  return process.env.POLITICA_DEFAULT_CONGRESS?.trim() || "119";
}

function buildCongressUrl(pathname: string, params?: Record<string, string | number | undefined>) {
  const url = new URL(`${CONGRESS_API_BASE}${pathname}`);
  return applyCongressQueryParams(url, params).toString();
}

function applyCongressQueryParams(url: URL, params?: Record<string, string | number | undefined>) {
  url.searchParams.set("format", "json");
  url.searchParams.set("api_key", getCongressApiKey());

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

function getCongressFetchSignal(timeoutOverrideMs?: number) {
  const timeoutMs = Number.isFinite(timeoutOverrideMs) && (timeoutOverrideMs ?? 0) > 0
    ? timeoutOverrideMs as number
    : Number.isFinite(CONGRESS_FETCH_TIMEOUT_MS) && CONGRESS_FETCH_TIMEOUT_MS > 0
      ? CONGRESS_FETCH_TIMEOUT_MS
      : 20000;
  return AbortSignal.timeout(timeoutMs);
}

function getCongressFetchRetryAttempts(overrideAttempts?: number) {
  return Number.isFinite(overrideAttempts) && (overrideAttempts ?? 0) > 0
    ? overrideAttempts as number
    : Number.isFinite(CONGRESS_FETCH_RETRY_ATTEMPTS) && CONGRESS_FETCH_RETRY_ATTEMPTS > 0
      ? CONGRESS_FETCH_RETRY_ATTEMPTS
      : 3;
}

function getCongressFetchRetryDelayMs(attempt: number) {
  const baseDelay = Number.isFinite(CONGRESS_FETCH_RETRY_BASE_DELAY_MS) && CONGRESS_FETCH_RETRY_BASE_DELAY_MS > 0
    ? CONGRESS_FETCH_RETRY_BASE_DELAY_MS
    : 750;
  const maxDelay = Number.isFinite(CONGRESS_FETCH_RETRY_MAX_DELAY_MS) && CONGRESS_FETCH_RETRY_MAX_DELAY_MS > 0
    ? CONGRESS_FETCH_RETRY_MAX_DELAY_MS
    : 5000;
  return Math.min(maxDelay, baseDelay * (2 ** Math.max(0, attempt - 1)));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryAfterDelayMs(response: Response) {
  const retryAfter = response.headers.get("retry-after")?.trim();
  if (!retryAfter) {
    return null;
  }

  const seconds = Number.parseFloat(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryDate = Date.parse(retryAfter);
  if (Number.isNaN(retryDate)) {
    return null;
  }

  return Math.max(0, retryDate - Date.now());
}

function isRetriableCongressStatus(status: number) {
  return status === 408
    || status === 425
    || status === 429
    || (status >= 500 && status < 600);
}

function isRetriableCongressError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  const cause = error.cause as { code?: string } | undefined;
  const code = cause?.code?.toUpperCase() || "";

  return name.includes("timeout")
    || name.includes("abort")
    || message.includes("terminated")
    || message.includes("socket")
    || code === "UND_ERR_SOCKET"
    || code === "UND_ERR_CONNECT_TIMEOUT"
    || code === "ECONNRESET"
    || code === "ETIMEDOUT"
    || code === "EAI_AGAIN";
}

async function fetchCongressWithRetry(
  url: string,
  accept: string,
  options?: {
    timeoutMs?: number;
    retryAttempts?: number;
  },
) {
  const attempts = getCongressFetchRetryAttempts(options?.retryAttempts);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: getCongressFetchSignal(options?.timeoutMs),
        headers: {
          Accept: accept,
        },
      });

      if (!response.ok) {
        if (attempt < attempts && isRetriableCongressStatus(response.status)) {
          const retryDelay = getRetryAfterDelayMs(response) ?? getCongressFetchRetryDelayMs(attempt);
          await sleep(retryDelay);
          continue;
        }

        throw new Error(`Congress API request failed: ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (error) {
      lastError = error;

      if (attempt >= attempts || !isRetriableCongressError(error)) {
        throw error;
      }

      await sleep(getCongressFetchRetryDelayMs(attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Congress API request failed");
}

async function fetchCongressJson<T>(pathname: string, params?: Record<string, string | number | undefined>) {
  const response = await fetchCongressWithRetry(
    buildCongressUrl(pathname, params),
    "application/json",
  );
  return (await response.json()) as T;
}

async function fetchCongressJsonByUrl<T>(urlString: string, params?: Record<string, string | number | undefined>) {
  const response = await fetchCongressWithRetry(
    applyCongressQueryParams(new URL(urlString, CONGRESS_API_BASE), params).toString(),
    "application/json",
  );
  return (await response.json()) as T;
}

export async function fetchCongressBills(options?: {
  congress?: string;
  limit?: number;
  offset?: number;
}) {
  const payload = await fetchCongressJson<{ bills?: CongressBillListItem[] }>(
    `/bill/${options?.congress || getDefaultCongress()}`,
    {
      limit: options?.limit ?? 20,
      offset: options?.offset ?? 0,
      // Pin the ordering to most-recently-updated first. This is Congress.gov's
      // current default, but the incremental sync depends on it (it walks the top
      // of this list each night), so make it explicit rather than trust the default.
      // URLSearchParams encodes the space as `+`, which the API expects.
      sort: "updateDate desc",
    },
  );

  return payload.bills ?? [];
}

export async function fetchCongressBillDetail(input: {
  congress: string;
  billType: string;
  billNumber: string;
}) {
  return fetchCongressJson<CongressBillDetailPayload>(
    `/bill/${input.congress}/${input.billType}/${input.billNumber}`,
  );
}

export async function fetchCongressBillActions(input: {
  congress: string;
  billType: string;
  billNumber: string;
  limit?: number;
  offset?: number;
}) {
  return fetchCongressJson<CongressBillActionPayload>(
    `/bill/${input.congress}/${input.billType}/${input.billNumber}/actions`,
    {
      limit: input.limit,
      offset: input.offset,
    },
  );
}

export async function fetchCongressBillSummaries(input: {
  congress: string;
  billType: string;
  billNumber: string;
  limit?: number;
  offset?: number;
}) {
  return fetchCongressJson<CongressBillSummaryPayload>(
    `/bill/${input.congress}/${input.billType}/${input.billNumber}/summaries`,
    {
      limit: input.limit,
      offset: input.offset,
    },
  );
}

export async function fetchCongressBillTextVersions(input: {
  congress: string;
  billType: string;
  billNumber: string;
}) {
  return fetchCongressJson<CongressBillTextPayload>(
    `/bill/${input.congress}/${input.billType}/${input.billNumber}/text`,
  );
}

export async function fetchCongressTextContent(url: string) {
  const response = await fetchCongressWithRetry(
    url,
    "text/plain,text/html,application/xml,text/xml;q=0.9,*/*;q=0.8",
  );
  return response.text();
}

export async function fetchCongressMembers(options?: {
  limit?: number;
  offset?: number;
}) {
  const payload = await fetchCongressJson<{ members?: CongressMemberListItem[] }>(
    "/member",
    {
      currentMember: "true",
      limit: options?.limit ?? 250,
      offset: options?.offset ?? 0,
    },
  );

  return payload.members ?? [];
}

export async function fetchCongressMemberDetail(bioguideId: string) {
  const response = await fetchCongressWithRetry(
    buildCongressUrl(`/member/${bioguideId}`),
    "application/json",
    {
      timeoutMs: Number.isFinite(CONGRESS_MEMBER_DETAIL_FETCH_TIMEOUT_MS) && CONGRESS_MEMBER_DETAIL_FETCH_TIMEOUT_MS > 0
        ? CONGRESS_MEMBER_DETAIL_FETCH_TIMEOUT_MS
        : 5000,
      retryAttempts: Number.isFinite(CONGRESS_MEMBER_DETAIL_FETCH_RETRY_ATTEMPTS) && CONGRESS_MEMBER_DETAIL_FETCH_RETRY_ATTEMPTS > 0
        ? CONGRESS_MEMBER_DETAIL_FETCH_RETRY_ATTEMPTS
        : 1,
    },
  );
  return (await response.json()) as CongressMemberDetailPayload;
}

const MEMBER_SPONSORED_LEGISLATION_PAGE_LIMIT = 250;
// Safety backstop against a runaway pagination loop -- no member has sponsored anywhere near
// 5,000 bills across their career.
const MEMBER_SPONSORED_LEGISLATION_MAX_ITEMS = 5000;

/**
 * A member's full sponsored-bill history across every congress they've served, not just the one
 * currently synced into the bills table. Congress.gov's `sponsoredLegislation.count` on the member
 * detail payload is a career total; this is the endpoint that actually backs that count.
 */
export async function fetchCongressMemberSponsoredLegislation(bioguideId: string) {
  const items: CongressMemberSponsoredLegislationItem[] = [];
  let offset = 0;

  for (;;) {
    const payload = await fetchCongressJson<CongressMemberSponsoredLegislationPayload>(
      `/member/${bioguideId}/sponsored-legislation`,
      { limit: MEMBER_SPONSORED_LEGISLATION_PAGE_LIMIT, offset },
    );
    const pageItems = payload.sponsoredLegislation ?? [];
    items.push(...pageItems);

    if (pageItems.length < MEMBER_SPONSORED_LEGISLATION_PAGE_LIMIT || items.length >= MEMBER_SPONSORED_LEGISLATION_MAX_ITEMS) {
      break;
    }

    offset += MEMBER_SPONSORED_LEGISLATION_PAGE_LIMIT;
  }

  return items;
}

export async function fetchCongressCommittees(options?: {
  congress?: string;
  chamber?: "house" | "senate" | "joint";
  limit?: number;
  offset?: number;
}) {
  const path = options?.congress ? `/committee/${options.congress}` : "/committee";
  const payload = await fetchCongressJson<{ committees?: CongressCommitteeListItem[] }>(
    path,
    {
      chamber: options?.chamber,
      limit: options?.limit ?? 250,
      offset: options?.offset ?? 0,
    },
  );

  return payload.committees ?? [];
}

export async function fetchCongressCommitteesByUrl(
  url: string,
  options?: {
    limit?: number;
    offset?: number;
  },
) {
  const payload = await fetchCongressJsonByUrl<{ committees?: CongressCommitteeListItem[] }>(url, {
    limit: options?.limit,
    offset: options?.offset,
  });

  return payload.committees ?? [];
}

/**
 * Only used for a committee's bills.url. Congress.gov nests that response under
 * "committee-bills" ({"committee-bills":{"bills":[...]}}), unlike the flat {"bills":[...]} shape
 * every other list endpoint uses -- confirmed by fetching it directly. Missing this made
 * fetchAllCommitteeBills silently treat page.length === 0 as "done" on the very first request, so
 * every committee's activeBillIds/active_bill_ids ended up [].
 */
export async function fetchCongressBillsByUrl(
  url: string,
  options?: {
    limit?: number;
    offset?: number;
  },
) {
  const payload = await fetchCongressJsonByUrl<{
    bills?: CongressBillListItem[];
    "committee-bills"?: { bills?: CongressBillListItem[] };
  }>(url, {
    limit: options?.limit,
    offset: options?.offset,
  });

  return payload.bills ?? payload["committee-bills"]?.bills ?? [];
}

export async function fetchCongressCommitteeDetail(input: {
  congress?: string;
  chamber: string;
  systemCode: string;
}) {
  const chamber = input.chamber.toLowerCase();
  const path = input.congress
    ? `/committee/${input.congress}/${chamber}/${input.systemCode}`
    : `/committee/${chamber}/${input.systemCode}`;

  return fetchCongressJson<CongressCommitteeDetailPayload>(path);
}
