import type { OpenStatesBill, OpenStatesCommittee, OpenStatesPerson, OpenStatesVote } from "@/types/openstates";

const OPENSTATES_API_BASE = process.env.POLITICA_OPENSTATES_API_BASE_URL?.trim()
  || "https://v3.openstates.org";
const OPENSTATES_PER_PAGE = 20;
const OPENSTATES_MAX_PAGES = 5;

function getOpenStatesApiKey() {
  return process.env.POLITICA_OPENSTATES_API_KEY?.trim() || "";
}

export function isOpenStatesConfigured() {
  return Boolean(getOpenStatesApiKey());
}

async function fetchOpenStatesJson<T>(pathname: string, params?: Record<string, string | number | undefined>) {
  const url = new URL(`${OPENSTATES_API_BASE}${pathname}`);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-API-KEY": getOpenStatesApiKey(),
    },
    next: { revalidate: 21600 },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `OpenStates request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`,
    );
  }

  return (await response.json()) as T;
}

async function fetchOpenStatesWithJurisdictionFallback<T>(
  pathname: string,
  state: string | undefined,
  params?: Record<string, string | number | undefined>,
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
  params?: Record<string, string | number | undefined>,
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
  return fetchOpenStatesPaginatedResults<OpenStatesPerson>("/people", state);
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

export async function fetchOpenStatesVotes(state?: string): Promise<OpenStatesVote[]> {
  const results = await fetchOpenStatesPaginatedResults<OpenStatesVote>("/votes", state, {
    sort: "updated_desc",
  }).catch(() => []);

  return results;
}
