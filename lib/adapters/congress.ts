import type {
  CongressBillActionPayload,
  CongressBillDetailPayload,
  CongressBillListItem,
  CongressBillSummaryPayload,
  CongressCommitteeDetailPayload,
  CongressCommitteeListItem,
  CongressMemberDetailPayload,
  CongressMemberListItem,
  CongressBillTextPayload,
} from "@/types/congress";

const CONGRESS_API_BASE = process.env.POLITICA_CONGRESS_API_BASE_URL?.trim()
  || "https://api.congress.gov/v3";
const CONGRESS_FETCH_TIMEOUT_MS = Number.parseInt(
  process.env.POLITICA_CONGRESS_FETCH_TIMEOUT_MS?.trim() || "20000",
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

function getCongressFetchSignal() {
  const timeoutMs = Number.isFinite(CONGRESS_FETCH_TIMEOUT_MS) && CONGRESS_FETCH_TIMEOUT_MS > 0
    ? CONGRESS_FETCH_TIMEOUT_MS
    : 20000;
  return AbortSignal.timeout(timeoutMs);
}

async function fetchCongressJson<T>(pathname: string, params?: Record<string, string | number | undefined>) {
  const response = await fetch(buildCongressUrl(pathname, params), {
    next: { revalidate: 21600 },
    signal: getCongressFetchSignal(),
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Congress API request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

async function fetchCongressJsonByUrl<T>(urlString: string, params?: Record<string, string | number | undefined>) {
  const response = await fetch(applyCongressQueryParams(new URL(urlString, CONGRESS_API_BASE), params).toString(), {
    next: { revalidate: 21600 },
    signal: getCongressFetchSignal(),
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Congress API request failed: ${response.status} ${response.statusText}`);
  }

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
}) {
  return fetchCongressJson<CongressBillActionPayload>(
    `/bill/${input.congress}/${input.billType}/${input.billNumber}/actions`,
  );
}

export async function fetchCongressBillSummaries(input: {
  congress: string;
  billType: string;
  billNumber: string;
}) {
  return fetchCongressJson<CongressBillSummaryPayload>(
    `/bill/${input.congress}/${input.billType}/${input.billNumber}/summaries`,
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
  const response = await fetch(url, {
    next: { revalidate: 21600 },
    signal: getCongressFetchSignal(),
    headers: {
      Accept: "text/plain,text/html,application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Congress text request failed: ${response.status} ${response.statusText}`);
  }

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
  return fetchCongressJson<CongressMemberDetailPayload>(`/member/${bioguideId}`);
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

export async function fetchCongressBillsByUrl(
  url: string,
  options?: {
    limit?: number;
    offset?: number;
  },
) {
  const payload = await fetchCongressJsonByUrl<{ bills?: CongressBillListItem[] }>(url, {
    limit: options?.limit,
    offset: options?.offset,
  });

  return payload.bills ?? [];
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
