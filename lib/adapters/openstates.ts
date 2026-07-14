import type { OpenStatesBill, OpenStatesCommittee, OpenStatesPerson, OpenStatesVote } from "@/types/openstates";

const OPENSTATES_API_BASE = process.env.POLITICA_OPENSTATES_API_BASE_URL?.trim()
  || "https://v3.openstates.org";
// per_page is hard-capped at 20 by the API. The old 5-page ceiling therefore capped every fetch
// at 100 rows, which is why only ~21 legislators per state were ever stored -- Texas alone has
// 184, and a roll-call voter cannot be matched to a member we never imported.
const OPENSTATES_PER_PAGE = 20;
const OPENSTATES_MAX_PAGES = Number(process.env.POLITICA_OPENSTATES_MAX_PAGES || 25);

// OpenStates allows 10 requests/minute and returns 429 past that. There was no throttle and no
// retry: a sync that tripped the limit simply threw. Serialize requests behind a minimum spacing
// and honour Retry-After.
const OPENSTATES_MIN_REQUEST_INTERVAL_MS = Number(process.env.POLITICA_OPENSTATES_MIN_INTERVAL_MS || 6500);
const OPENSTATES_MAX_ATTEMPTS = 4;

let requestChain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serializes every OpenStates call and spaces them out, so concurrent callers cannot burst. */
function throttle<T>(task: () => Promise<T>): Promise<T> {
  const scheduled = requestChain.then(async () => {
    const wait = lastRequestAt + OPENSTATES_MIN_REQUEST_INTERVAL_MS - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }
    lastRequestAt = Date.now();
    return task();
  });

  requestChain = scheduled.catch(() => undefined);
  return scheduled;
}

function getOpenStatesApiKey() {
  return process.env.POLITICA_OPENSTATES_API_KEY?.trim() || "";
}

export function isOpenStatesConfigured() {
  return Boolean(getOpenStatesApiKey());
}

type OpenStatesParams = Record<string, string | number | string[] | undefined>;

async function fetchOpenStatesJson<T>(pathname: string, params?: OpenStatesParams) {
  const url = new URL(`${OPENSTATES_API_BASE}${pathname}`);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === "") {
      continue;
    }

    // OpenStates v3 expects repeated params for list-valued args (?include=links&include=offices),
    // not a comma-joined single value.
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item);
      }
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  for (let attempt = 1; attempt <= OPENSTATES_MAX_ATTEMPTS; attempt += 1) {
    const response = await throttle(() =>
      fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "X-API-KEY": getOpenStatesApiKey(),
        },
        next: { revalidate: 21600 },
      }));

    if (response.ok) {
      return (await response.json()) as T;
    }

    const detail = await response.text().catch(() => "");

    // Two different 429s. The per-minute limit clears on its own, so back off and retry. The
    // daily quota does not -- retrying just burns wall-clock and hammers the API, so surface it
    // immediately and let the caller stop.
    if (response.status === 429 && /\/day/i.test(detail)) {
      throw new Error(
        `OpenStates daily quota exhausted: ${detail.trim()}. Requests reset at 00:00 UTC; `
        + "sync fewer states per run or use a key with a higher quota.",
      );
    }

    const retriable = response.status === 429 || response.status >= 500;
    if (!retriable || attempt === OPENSTATES_MAX_ATTEMPTS) {
      throw new Error(
        `OpenStates request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`,
      );
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    await sleep(
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : OPENSTATES_MIN_REQUEST_INTERVAL_MS * 2 ** attempt,
    );
  }

  throw new Error("OpenStates request failed: retries exhausted");
}

async function fetchOpenStatesWithJurisdictionFallback<T>(
  pathname: string,
  state: string | undefined,
  params?: OpenStatesParams,
) {
  const trimmedState = state?.trim();
  const jurisdictionCandidates = trimmedState
    ? [
        `ocd-jurisdiction/country:us/state:${trimmedState.toLowerCase()}/government`,
        trimmedState.toLowerCase(),
        trimmedState.toUpperCase(),
      ]
    : [undefined];

  let lastError: unknown;

  for (const jurisdiction of jurisdictionCandidates) {
    try {
      return await fetchOpenStatesJson<T>(pathname, {
        ...params,
        jurisdiction,
      });
    } catch (error) {
      lastError = error;

      if (!(error instanceof Error) || !error.message.includes("400")) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("OpenStates request failed");
}

async function fetchOpenStatesPaginatedResults<T>(
  pathname: string,
  state: string | undefined,
  params?: OpenStatesParams,
) {
  const results: T[] = [];

  for (let page = 1; page <= OPENSTATES_MAX_PAGES; page += 1) {
    const payload = await fetchOpenStatesWithJurisdictionFallback<{ results?: T[] }>(pathname, state, {
      ...params,
      page,
      per_page: OPENSTATES_PER_PAGE,
    });
    const pageResults = payload.results ?? [];
    results.push(...pageResults);

    if (pageResults.length < OPENSTATES_PER_PAGE) {
      break;
    }
  }

  return results;
}

export async function fetchOpenStatesPeople(state?: string) {
  // Without `include`, OpenStates omits links and offices entirely -- which is why state-sync
  // read person.links[0].url off a payload that had no links key and stored a placeholder
  // website, phone and address for every state legislator.
  return fetchOpenStatesPaginatedResults<OpenStatesPerson>("/people", state, {
    include: ["links", "offices"],
  });
}

export async function fetchOpenStatesBills(state?: string) {
  return fetchOpenStatesPaginatedResults<OpenStatesBill>("/bills", state, {
    sort: "updated_desc",
  });
}

export async function fetchOpenStatesBillDetail(billId: string) {
  return fetchOpenStatesJson<OpenStatesBill>(`/bills/${billId}`);
}

export async function fetchOpenStatesCommittees(state?: string) {
  return fetchOpenStatesPaginatedResults<OpenStatesCommittee>("/committees", state);
}

export async function fetchOpenStatesCommitteeDetail(committeeId: string) {
  return fetchOpenStatesJson<OpenStatesCommittee>(`/committees/${committeeId}`);
}

/**
 * OpenStates v3 has no /votes endpoint -- it returns 404. This used to call it and swallow the
 * failure with `.catch(() => [])`, so state vote sync reported success while importing nothing,
 * which is why every state legislator has zero attendance.
 *
 * Votes are only exposed as an embedded resource on bills. The list endpoint accepts
 * `include=votes`, so a page of bills carries its roll calls with it -- no per-bill detail fetch.
 */
export async function fetchOpenStatesBillsWithVotes(state?: string) {
  return fetchOpenStatesPaginatedResults<OpenStatesBill>("/bills", state, {
    sort: "updated_desc",
    include: ["votes"],
  });
}

export async function fetchOpenStatesVotes(state?: string): Promise<OpenStatesVote[]> {
  const bills = await fetchOpenStatesBillsWithVotes(state).catch(() => [] as OpenStatesBill[]);
  return bills.flatMap((bill) =>
    (bill.votes ?? []).map((vote) => ({
      ...vote,
      bill: vote.bill ?? { identifier: bill.identifier },
    })),
  );
}
