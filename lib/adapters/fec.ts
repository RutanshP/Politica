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
const FEC_REQUEST_TIMEOUT_MS = 30_000;
// Timeouts, dropped connections and 5xx. Separate from the 429 budget above, which waits out a
// rate window rather than a flaky request.
const FEC_TRANSIENT_RETRIES = 2;
const FEC_TRANSIENT_BACKOFF_MS = 2000;

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

  for (let attempt = 0, transientAttempt = 0; ;) {
    await fecRateGate();
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(FEC_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // A page that hangs past the abort, or a dropped connection, is usually gone on the next
      // try. Without this, one slow page failed the whole candidate roster sync (2026-10-12).
      if (transientAttempt < FEC_TRANSIENT_RETRIES) {
        transientAttempt += 1;
        await new Promise((resolve) => setTimeout(resolve, FEC_TRANSIENT_BACKOFF_MS * transientAttempt));
        continue;
      }
      throw error;
    }

    if (response.status >= 500 && transientAttempt < FEC_TRANSIENT_RETRIES) {
      transientAttempt += 1;
      await new Promise((resolve) => setTimeout(resolve, FEC_TRANSIENT_BACKOFF_MS * transientAttempt));
      continue;
    }

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
      attempt += 1;
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

/*
 * Form 3 receipt lines that are a committee's own money: 11B from party committees, 11C from
 * other political committees (PACs, leadership PACs, other campaigns). Earmarked contributions a
 * conduit forwards are reported on the individual lines (11A), and transfers from the
 * candidate's own committees on line 12, so neither is counted as a committee's gift.
 */
const COMMITTEE_RECEIPT_LINES = ["F3-11B", "F3-11C"] as const;

interface FecScheduleAReceiptRow {
  contributor_id?: string | null;
  contribution_receipt_amount?: number;
  memo_code?: string | null;
  memo_text?: string | null;
  receipt_type?: string | null;
  receipt_type_full?: string | null;
}

/*
 * Conduit platforms. They only ever forward individuals' contributions, so nothing they pass on
 * is their own gift -- yet campaigns put WinRed lump sums on line 11C (Vince Fong: $28,873).
 */
const CONDUIT_COMMITTEE_IDS = new Set([
  "C00401224", // ActBlue
  "C00694323", // WinRed
]);

/*
 * Some campaigns file a conduit's forwarded money on line 11C too, labelled as such: Norma
 * Torres's report puts $91,820 under AIPAC PAC as "EARMARKED CONTRIBUTION(S)", against AIPAC's
 * $10,000-a-cycle limit. Those rows say so in the receipt type or memo.
 */
function isForwardedMoney(row: FecScheduleAReceiptRow) {
  if (row.receipt_type && /^15[EIJ]$/i.test(row.receipt_type)) return true;
  return /earmark|intermediar|conduit/i.test(`${row.receipt_type_full ?? ""} ${row.memo_text ?? ""}`);
}

/**
 * Every committee that gave to a candidate's committee in a cycle, totalled per giver, from the
 * *recipient's* own itemized receipts.
 *
 * This replaced FEC's Schedule B "by recipient" aggregates, built from the payers' reports, which
 * counted conduit earmarks as the conduit's own gifts (AIPAC PAC "gave" Josh Gottheimer $70,723
 * in 2026; its own contribution was $5,000, and the $784,126 it forwarded was individuals'
 * money), counted transfers between a member's own committees, and lagged the itemized filings.
 */
export async function fetchFecCommitteeGiftsToRecipient(recipientCommitteeId: string, cycle: number) {
  const byGiver = new Map<string, FecCommitteeGiftRow>();
  for (const line of COMMITTEE_RECEIPT_LINES) {
    let lastIndexes: Record<string, string> = {};
    for (;;) {
      const payload = await fetchFecJsonFresh<{
        results?: FecScheduleAReceiptRow[];
        pagination?: { last_indexes?: { last_index?: string; last_contribution_receipt_date?: string } | null };
      }>("/schedules/schedule_a/", {
        committee_id: recipientCommitteeId,
        two_year_transaction_period: cycle,
        line_number: line,
        per_page: FEC_AGGREGATE_PAGE_SIZE,
        ...lastIndexes,
      });
      const results = payload.results ?? [];
      for (const row of results) {
        // Memo lines restate money already counted on another line.
        if (!row.contributor_id || row.memo_code === "X") continue;
        if (CONDUIT_COMMITTEE_IDS.has(row.contributor_id) || isForwardedMoney(row)) continue;
        const entry = byGiver.get(row.contributor_id) ?? { committee_id: row.contributor_id, total: 0, count: 0 };
        entry.total = (entry.total ?? 0) + (row.contribution_receipt_amount ?? 0);
        entry.count = (entry.count ?? 0) + 1;
        byGiver.set(row.contributor_id, entry);
      }
      const next = payload.pagination?.last_indexes;
      if (results.length < FEC_AGGREGATE_PAGE_SIZE || !next?.last_index) break;
      lastIndexes = {
        last_index: next.last_index,
        ...(next.last_contribution_receipt_date ? { last_contribution_receipt_date: next.last_contribution_receipt_date } : {}),
      };
    }
  }
  return [...byGiver.values()];
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
