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

// ---------------------------------------------------------------------------
// Sync-path fetchers (cache: no-store -- the funding-graph sync must observe
// current FEC data, and its results are persisted to Supabase anyway).
// ---------------------------------------------------------------------------

const FEC_RATE_LIMIT_RETRIES = 3;
const FEC_RATE_LIMIT_BACKOFF_MS = 20000;

// The FEC key allows 60 requests/minute. Rather than fire calls as fast as
// possible and recover from 429s with backoff (which makes throughput lurch
// between fast and stalled), pace every fresh call ~1.1s apart so a single
// worker sustains ~54/min and never trips the limit. Slots are reserved
// atomically, so even a burst of concurrent calls comes out evenly spaced.
const MIN_FEC_INTERVAL_MS = 1100;
let fecNextAllowedAt = 0;

async function fecRateGate() {
  const now = Date.now();
  const scheduledAt = Math.max(now, fecNextAllowedAt);
  fecNextAllowedAt = scheduledAt + MIN_FEC_INTERVAL_MS;
  const wait = scheduledAt - now;
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

async function fetchFecJsonFresh<T>(
  pathname: string,
  params?: Record<string, string | number | undefined>,
) {
  const url = new URL(`${FEC_API_BASE}${pathname}`);
  url.searchParams.set("api_key", getFecApiKey());
  url.searchParams.set("per_page", String(params?.per_page ?? 20));

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && key !== "per_page") {
      url.searchParams.set(key, String(value));
    }
  }

  for (let attempt = 0; ; attempt += 1) {
    await fecRateGate();
    const response = await fetch(url.toString(), {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });

    if (response.status === 429 && attempt < FEC_RATE_LIMIT_RETRIES) {
      // The hourly key also enforces a short-window burst limit; honor
      // Retry-After when present, otherwise back off long enough for the
      // rolling window to clear.
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : FEC_RATE_LIMIT_BACKOFF_MS * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    if (!response.ok) {
      throw new Error(`FEC API request failed: ${response.status} ${response.statusText} (${pathname})`);
    }

    return (await response.json()) as T;
  }
}

export interface FecCandidateTotalsRow {
  cycle?: number;
  receipts?: number;
  disbursements?: number;
  cash_on_hand_end_period?: number;
  individual_contributions?: number;
  individual_itemized_contributions?: number;
  individual_unitemized_contributions?: number;
  other_political_committee_contributions?: number;
  political_party_committee_contributions?: number;
  candidate_contribution?: number;
  transfers_from_other_authorized_committee?: number;
}

export async function fetchFecCandidateTotalsDetailed(candidateId: string, cycle: number) {
  const payload = await fetchFecJsonFresh<{ results?: FecCandidateTotalsRow[] }>(
    `/candidate/${encodeURIComponent(candidateId)}/totals/`,
    { cycle, per_page: 5 },
  );
  return payload.results ?? [];
}

export interface FecCommitteeRow {
  committee_id?: string;
  name?: string;
  designation?: string;
  designation_full?: string;
  committee_type_full?: string;
}

export async function fetchFecCandidateCommittees(candidateId: string, cycle: number) {
  const payload = await fetchFecJsonFresh<{ results?: FecCommitteeRow[] }>(
    `/candidate/${encodeURIComponent(candidateId)}/committees/`,
    { cycle, per_page: 20 },
  );
  return payload.results ?? [];
}

export interface FecEmployerAggregateRow {
  employer?: string | null;
  total?: number;
  count?: number;
}

export async function fetchFecScheduleAByEmployer(committeeId: string, cycle: number) {
  const payload = await fetchFecJsonFresh<{ results?: FecEmployerAggregateRow[] }>(
    "/schedules/schedule_a/by_employer/",
    { committee_id: committeeId, cycle, per_page: 30, sort: "-total" },
  );
  return payload.results ?? [];
}

export interface FecSizeAggregateRow {
  size?: number;
  total?: number;
  count?: number | null;
}

export async function fetchFecScheduleABySize(committeeId: string, cycle: number) {
  const payload = await fetchFecJsonFresh<{ results?: FecSizeAggregateRow[] }>(
    "/schedules/schedule_a/by_size/",
    { committee_id: committeeId, cycle, per_page: 10 },
  );
  return payload.results ?? [];
}

export interface FecScheduleEByCandidateRow {
  support_oppose_indicator?: "S" | "O" | string;
  total?: number;
  count?: number;
  cycle?: number;
}

export async function fetchFecScheduleEByCandidate(candidateId: string, cycle: number) {
  const payload = await fetchFecJsonFresh<{ results?: FecScheduleEByCandidateRow[] }>(
    "/schedules/schedule_e/by_candidate/",
    { candidate_id: candidateId, cycle, per_page: 10 },
  );
  return payload.results ?? [];
}
