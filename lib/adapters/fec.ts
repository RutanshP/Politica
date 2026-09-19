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
const FEC_MAX_RETRY_WAIT_MS = 60_000;

/** The key's hourly quota is spent; callers should stop and let the next run carry on. */
export class FecQuotaExhaustedError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`FEC API hourly quota exhausted; retry in ${retryAfterSeconds}s`);
    this.name = "FecQuotaExhaustedError";
  }
}

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
  params?: Record<string, string | number | string[] | undefined>,
) {
  const url = new URL(`${FEC_API_BASE}${pathname}`);
  url.searchParams.set("api_key", getFecApiKey());
  url.searchParams.set("per_page", String(params?.per_page ?? 20));

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || key === "per_page") continue;
    // Arrays repeat the parameter (`committee_id=A&committee_id=B`), which is how the FEC API
    // takes a batch of ids.
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
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
      // A short burst limit is worth waiting out. The hourly quota answers with a Retry-After of
      // ten minutes or more, and sleeping through that three times outlives any function
      // timeout -- the sync then dies without saving the members it had already finished.
      if (waitMs > FEC_MAX_RETRY_WAIT_MS) {
        throw new FecQuotaExhaustedError(Math.round(waitMs / 1000));
      }
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

export interface FecCommitteeGiftRow {
  committee_id?: string;
  committee_name?: string;
  recipient_id?: string;
  total?: number;
  count?: number;
  memo_total?: number;
}

const FEC_AGGREGATE_PAGE_SIZE = 100;

/**
 * Every committee that paid a candidate's committee in a cycle, totalled per payer.
 *
 * This is Schedule B from the *payer's* side -- PACs, party committees, leadership PACs and
 * other campaigns reporting what they gave -- aggregated by FEC per (payer, recipient). One call
 * per 100 payers; a senator runs to a few hundred.
 */
export async function fetchFecCommitteeGiftsToRecipient(recipientCommitteeId: string, cycle: number) {
  const rows: FecCommitteeGiftRow[] = [];
  for (let page = 1; ; page += 1) {
    const payload = await fetchFecJsonFresh<{
      results?: FecCommitteeGiftRow[];
      pagination?: { pages?: number };
    }>("/schedules/schedule_b/by_recipient_id/", {
      recipient_id: recipientCommitteeId,
      cycle,
      per_page: FEC_AGGREGATE_PAGE_SIZE,
      sort: "-total",
      page,
    });
    rows.push(...(payload.results ?? []));
    if (page >= (payload.pagination?.pages ?? 1)) return rows;
  }
}

export interface FecCommitteeDetailRow {
  committee_id: string;
  name?: string;
  committee_type?: string;
  designation?: string;
  organization_type?: string | null;
  party?: string | null;
  affiliated_committee_name?: string | null;
  sponsor_candidate_ids?: string[] | null;
  candidate_ids?: string[] | null;
}

/** Committee records for up to 100 ids in one call. */
export async function fetchFecCommitteesByIds(committeeIds: string[]) {
  if (committeeIds.length === 0) return [];
  const payload = await fetchFecJsonFresh<{ results?: FecCommitteeDetailRow[] }>("/committees/", {
    committee_id: committeeIds.slice(0, FEC_AGGREGATE_PAGE_SIZE),
    per_page: FEC_AGGREGATE_PAGE_SIZE,
  });
  return payload.results ?? [];
}

export interface FecCandidateRow {
  candidate_id?: string;
  name?: string;
  office?: string;
  office_full?: string;
  party?: string;
  party_full?: string;
  state?: string;
  district?: string;
  election_years?: number[];
  cycles?: number[];
  incumbent_challenge?: string;
  incumbent_challenge_full?: string;
  candidate_status?: string;
  candidate_inactive?: boolean;
  active_through?: number;
}

const FEC_CANDIDATES_PAGE_SIZE = 100;

/** Every candidate filed for an office in a cycle -- House, Senate, and President all come from this one endpoint, keyed by `office`. */
export async function fetchFecCandidatesByOfficeCycle(office: "H" | "S" | "P", cycle: number) {
  const candidates: FecCandidateRow[] = [];
  let page = 1;

  while (true) {
    const payload = await fetchFecJsonFresh<{
      results?: FecCandidateRow[];
      pagination?: { page?: number; pages?: number };
    }>("/candidates/", {
      office,
      cycle,
      per_page: FEC_CANDIDATES_PAGE_SIZE,
      page,
    });

    candidates.push(...(payload.results ?? []));

    const totalPages = payload.pagination?.pages ?? page;
    if (page >= totalPages || !payload.results?.length) {
      break;
    }
    page += 1;
  }

  return candidates;
}
