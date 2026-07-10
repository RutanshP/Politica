import type { OpenStatesBill, OpenStatesPerson, OpenStatesVote } from "@/types/openstates";

const OPENSTATES_API_BASE = process.env.POLITICA_OPENSTATES_API_BASE_URL?.trim()
  || "https://v3.openstates.org";

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
    throw new Error(`OpenStates request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function fetchOpenStatesPeople(state?: string) {
  const payload = await fetchOpenStatesJson<{ results?: OpenStatesPerson[] }>("/people", {
    jurisdiction: state ? `ocd-jurisdiction/country:us/state:${state.toLowerCase()}/government` : undefined,
    per_page: 100,
  });

  return payload.results ?? [];
}

export async function fetchOpenStatesBills(state?: string) {
  const payload = await fetchOpenStatesJson<{ results?: OpenStatesBill[] }>("/bills", {
    jurisdiction: state ? `ocd-jurisdiction/country:us/state:${state.toLowerCase()}/government` : undefined,
    per_page: 100,
    sort: "updated_at",
  });

  return payload.results ?? [];
}

export async function fetchOpenStatesVotes(state?: string) {
  const payload = await fetchOpenStatesJson<{ results?: OpenStatesVote[] }>("/votes", {
    jurisdiction: state ? `ocd-jurisdiction/country:us/state:${state.toLowerCase()}/government` : undefined,
    per_page: 100,
    sort: "start_date",
  });

  return payload.results ?? [];
}
