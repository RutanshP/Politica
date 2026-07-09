const FEC_API_BASE = process.env.POLITICA_FEC_API_BASE_URL?.trim()
  || "https://api.open.fec.gov/v1";

function getFecApiKey() {
  return process.env.POLITICA_FEC_API_KEY?.trim()
    || process.env.FEC_API_KEY?.trim()
    || "";
}

export function isFecConfigured() {
  return Boolean(getFecApiKey());
}

async function fetchFecJson<T>(
  pathname: string,
  params?: Record<string, string | number | undefined>,
) {
  const url = new URL(`${FEC_API_BASE}${pathname}`);
  url.searchParams.set("api_key", getFecApiKey());
  url.searchParams.set("sort_null_only", "false");
  url.searchParams.set("per_page", String(params?.per_page ?? 20));

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && key !== "per_page") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    next: { revalidate: 86400 },
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`FEC API request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function searchFecCandidatesByName(name: string, cycle = 2024) {
  return fetchFecJson<{
    results?: Array<{
      candidate_id?: string;
      name?: string;
      office_full?: string;
      party_full?: string;
      state?: string;
    }>;
  }>("/names/candidates/", {
    q: name,
    election_year: cycle,
    per_page: 5,
  });
}

export async function fetchFecCandidateTotals(candidateId: string, cycle = 2024) {
  return fetchFecJson<{
    results?: Array<{
      receipts?: number;
      disbursements?: number;
      cash_on_hand_end_period?: number;
      committee_id?: string;
      committee_name?: string;
    }>;
  }>(`/candidate/${candidateId}/totals/`, {
    cycle,
    per_page: 10,
  });
}
