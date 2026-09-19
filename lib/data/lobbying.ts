import { congressForYear, filingDocumentUrl, issueName } from "@/lib/lobbying/lda-text";
import { organizationKey, tidyOrganizationName } from "@/lib/organization-names";
import { LOBBYING_CACHE_TAG } from "@/lib/supabase/cache-tags";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { fetchSupabaseRpcRows } from "@/lib/supabase/rest";

/*
 * Lobbying Disclosure Act reports for the current Congress, read through the aggregate functions
 * in supabase/sql/033. What the figures mean, because it shapes every label that shows them:
 *
 *   - Spend counts each quarter once per client: an organization's in-house report when it filed
 *     one (it already includes what it paid outside firms), otherwise the sum of its firms'
 *     reports. Only the latest report for a quarter counts, so amendments replace, not add.
 *   - Firms under $5,000 a quarter report no figure, so small engagements show as $0.
 *   - A report citing a bill says the client lobbied on it that quarter, not how much of the
 *     quarter's money went to it -- so bills carry counts of organizations, never dollars.
 */

const READ = { tags: [LOBBYING_CACHE_TAG] };

/** 20262 -> { year: 2026, quarter: 2, label: "Q2 2026" } */
export function decodeQuarter(index: number | null | undefined) {
  if (!index) return null;
  const year = Math.floor(index / 10);
  const quarter = index % 10;
  return { year, quarter, label: quarter ? `Q${quarter} ${year}` : String(year) };
}

/** The years of the Congress in session, oldest first: [2025, 2026]. */
export function currentCongressYears(now = new Date()) {
  const year = now.getUTCFullYear();
  return congressForYear(year - 1) === congressForYear(year) ? [year - 1, year] : [year];
}

/** The latest year with reports on file -- the current year, unless it has none yet. */
export async function latestLobbyingYear() {
  const years = currentCongressYears();
  for (const year of [...years].reverse()) {
    const overview = await getLobbyingOverview(year);
    if (overview.reports > 0) return year;
  }
  return years[years.length - 1];
}

export const clientHref = (clientKey: string) => `/money/lobbying/${encodeURIComponent(clientKey)}`;
export const displayOrganization = (name: string | null | undefined) => tidyOrganizationName(name?.trim() || "Unnamed organization");

/**
 * A failed read renders as "no lobbying" rather than breaking the page -- but it is logged, because
 * swallowing it silently is how a broken lobbying_bill_clients hid every bill's lobbying card.
 */
async function rpc<T>(name: string, args: Record<string, string>) {
  if (!isSupabaseConfigured()) return [] as T[];
  return fetchSupabaseRpcRows<T>(name, args, READ).catch((error: unknown) => {
    console.error(`[lobbying] ${name} failed:`, error instanceof Error ? error.message : error);
    return [] as T[];
  });
}

const num = (value: number | string | null | undefined) => Number(value) || 0;

export interface LobbyingOverview {
  year: number;
  spend: number;
  reports: number;
  clients: number;
  firms: number;
  quarters: Array<{ quarter: number; spend: number; reports: number; clients: number }>;
}

export async function getLobbyingOverview(year: number): Promise<LobbyingOverview> {
  const rows = await rpc<{ period: string; spend: string; reports: string; clients: string; firms: string }>(
    "lobbying_overview",
    { p_year: String(year) },
  );
  const total = rows.find((row) => row.period === "year");
  const quarterOf = ["first_quarter", "second_quarter", "third_quarter", "fourth_quarter"];
  return {
    year,
    spend: num(total?.spend),
    reports: num(total?.reports),
    clients: num(total?.clients),
    firms: num(total?.firms),
    quarters: rows
      .filter((row) => quarterOf.includes(row.period))
      .map((row) => ({
        quarter: quarterOf.indexOf(row.period) + 1,
        spend: num(row.spend),
        reports: num(row.reports),
        clients: num(row.clients),
      }))
      .sort((left, right) => left.quarter - right.quarter),
  };
}

export interface LobbyingClientRow {
  clientKey: string;
  name: string;
  spend: number;
  firms: number;
  reports: number;
  bills: number;
  inHouse: boolean;
}

export async function getTopLobbyingClients(year: number, limit = 25, search?: string): Promise<LobbyingClientRow[]> {
  const key = search ? organizationKey(search) : "";
  if (search && !key) return [];
  const rows = await rpc<{
    client_key: string;
    client_name: string;
    spend: string;
    firms: string;
    reports: string;
    bills: string;
    in_house: boolean;
  }>("lobbying_top_clients", { p_year: String(year), p_limit: String(limit), ...(key ? { p_search: key } : {}) });
  return rows
    .filter((row) => row.client_key)
    .map((row) => ({
      clientKey: row.client_key,
      name: displayOrganization(row.client_name),
      spend: num(row.spend),
      firms: num(row.firms),
      reports: num(row.reports),
      bills: num(row.bills),
      inHouse: Boolean(row.in_house),
    }));
}

export interface LobbyingFirmRow {
  registrantId: string;
  name: string;
  income: number;
  clients: number;
}

export async function getTopLobbyingFirms(year: number, limit = 25): Promise<LobbyingFirmRow[]> {
  const rows = await rpc<{ registrant_id: string; registrant_name: string; income: string; clients: string }>(
    "lobbying_top_firms",
    { p_year: String(year), p_limit: String(limit) },
  );
  return rows.map((row) => ({
    registrantId: row.registrant_id,
    name: displayOrganization(row.registrant_name),
    income: num(row.income),
    clients: num(row.clients),
  }));
}

export interface LobbiedBillRow {
  billId: string;
  number: string;
  title: string;
  status: string;
  sponsorName: string | null;
  clients: number;
  reports: number;
  lastQuarter: string | null;
}

export async function getMostLobbiedBills(options: {
  years?: number[];
  limit?: number;
  issueId?: string;
  sponsorId?: string;
} = {}): Promise<LobbiedBillRow[]> {
  const years = options.years ?? currentCongressYears();
  const rows = await rpc<{
    bill_id: string;
    number: string;
    title: string;
    status: string;
    sponsor_name: string | null;
    clients: string;
    reports: string;
    last_quarter: number;
  }>("lobbying_top_bills", {
    p_years: `{${years.join(",")}}`,
    p_limit: String(options.limit ?? 25),
    ...(options.issueId ? { p_issue: options.issueId } : {}),
    ...(options.sponsorId ? { p_sponsor: options.sponsorId } : {}),
  });
  return rows.map((row) => ({
    billId: row.bill_id,
    number: row.number,
    title: row.title,
    status: row.status,
    sponsorName: row.sponsor_name,
    clients: num(row.clients),
    reports: num(row.reports),
    lastQuarter: decodeQuarter(row.last_quarter)?.label ?? null,
  }));
}

export interface BillLobbyingRow {
  clientKey: string;
  name: string;
  firms: string[];
  inHouse: boolean;
  reports: number;
  firstQuarter: string | null;
  lastQuarter: string | null;
  latestFilingUrl: string | null;
  issues: string[];
}

export interface BillLobbying {
  /** The organizations shown -- the most active, capped. */
  rows: BillLobbyingRow[];
  /** All organizations and outside firms that named the bill, beyond the cap. */
  totalClients: number;
  totalFirms: number;
}

export async function getBillLobbying(billId: string, limit = 100): Promise<BillLobbying> {
  const rows = await rpc<{
    client_key: string;
    client_name: string;
    firms: string[] | null;
    in_house: boolean;
    reports: string;
    first_quarter: number;
    last_quarter: number;
    latest_filing_uuid: string | null;
    issue_codes: string[] | null;
    total_clients: string;
    total_firms: string;
  }>("lobbying_bill_clients", { p_bill_id: billId, p_limit: String(limit) });
  return {
    totalClients: num(rows[0]?.total_clients),
    totalFirms: num(rows[0]?.total_firms),
    rows: rows
    .filter((row) => row.client_key)
    .map((row) => ({
      clientKey: row.client_key,
      name: displayOrganization(row.client_name),
      firms: (row.firms ?? []).map(displayOrganization),
      inHouse: Boolean(row.in_house),
      reports: num(row.reports),
      firstQuarter: decodeQuarter(row.first_quarter)?.label ?? null,
      lastQuarter: decodeQuarter(row.last_quarter)?.label ?? null,
      latestFilingUrl: row.latest_filing_uuid ? filingDocumentUrl(row.latest_filing_uuid) : null,
      issues: (row.issue_codes ?? []).map(issueName),
    })),
  };
}

export interface LobbyingIssueRow {
  code: string;
  name: string;
  reports: number;
  clients: number;
}

export async function getLobbyingIssues(year: number): Promise<LobbyingIssueRow[]> {
  const rows = await rpc<{ issue_code: string; reports: string; clients: string }>("lobbying_issue_counts", {
    p_year: String(year),
  });
  return rows.map((row) => ({
    code: row.issue_code,
    name: issueName(row.issue_code),
    reports: num(row.reports),
    clients: num(row.clients),
  }));
}

export interface LobbyingClientDetail {
  clientKey: string;
  name: string;
  inHouse: boolean;
  quarters: Array<{ label: string; year: number; quarter: number; spend: number }>;
  totalSpend: number;
  firms: Array<{ registrantId: string; name: string; inHouse: boolean; amount: number; reports: number; lastQuarter: string | null }>;
  bills: Array<{ billId: string; number: string; title: string; status: string; reports: number; lastQuarter: string | null }>;
  issues: Array<{ code: string; name: string; reports: number }>;
  reports: Array<{ url: string; quarter: string; filingType: string; firm: string; inHouse: boolean; amount: number | null }>;
}

interface ClientDetailJson {
  name: string | null;
  in_house: boolean;
  quarters: Array<{ quarter: number; spend: number | string }>;
  firms: Array<{ registrant_id: string; name: string | null; in_house: boolean; amount: number | string; reports: number; last_quarter: number }>;
  bills: Array<{ bill_id: string; number: string; title: string; status: string; reports: number; last_quarter: number }>;
  issues: Array<{ code: string; reports: number }>;
  reports: Array<{ filing_uuid: string; quarter: number; filing_type: string; registrant_name: string | null; is_in_house: boolean; amount: number | string | null }>;
}

export async function getLobbyingClient(clientKey: string): Promise<LobbyingClientDetail | null> {
  if (!isSupabaseConfigured() || !clientKey) return null;
  const detail = (await fetchSupabaseRpcRows<ClientDetailJson>(
    "lobbying_client_detail",
    { p_client_key: clientKey },
    READ,
  ).catch((error: unknown) => {
    console.error("[lobbying] lobbying_client_detail failed:", error instanceof Error ? error.message : error);
    return null;
  })) as unknown as ClientDetailJson | null;
  if (!detail?.name) return null;

  const quarters = (detail.quarters ?? []).flatMap((row) => {
    const decoded = decodeQuarter(row.quarter);
    return decoded ? [{ ...decoded, spend: num(row.spend) }] : [];
  });
  return {
    clientKey,
    name: displayOrganization(detail.name),
    inHouse: Boolean(detail.in_house),
    quarters,
    totalSpend: quarters.reduce((sum, row) => sum + row.spend, 0),
    firms: (detail.firms ?? []).map((row) => ({
      registrantId: row.registrant_id,
      name: displayOrganization(row.name),
      inHouse: Boolean(row.in_house),
      amount: num(row.amount),
      reports: num(row.reports),
      lastQuarter: decodeQuarter(row.last_quarter)?.label ?? null,
    })),
    bills: (detail.bills ?? []).map((row) => ({
      billId: row.bill_id,
      number: row.number,
      title: row.title,
      status: row.status,
      reports: num(row.reports),
      lastQuarter: decodeQuarter(row.last_quarter)?.label ?? null,
    })),
    issues: (detail.issues ?? []).map((row) => ({ code: row.code, name: issueName(row.code), reports: num(row.reports) })),
    reports: (detail.reports ?? []).map((row) => ({
      url: filingDocumentUrl(row.filing_uuid),
      quarter: decodeQuarter(row.quarter)?.label ?? "",
      filingType: row.filing_type,
      firm: displayOrganization(row.registrant_name),
      inHouse: Boolean(row.is_in_house),
      amount: row.amount === null ? null : num(row.amount),
    })),
  };
}

export interface LobbyingIndexRow {
  clientKey: string;
  name: string;
  spend: number;
  firms: number;
  bills: number;
}

/**
 * The lobbying clients worth a search entry this Congress, biggest spenders first. 1,000 because
 * that is also PostgREST's response cap -- asking for more silently returns 1,000 anyway -- and
 * the long tail below it is organizations that reported little or nothing. Uncached: the search
 * rebuild reads it once.
 */
export async function listLobbyingClientsForIndex(limit = 1000): Promise<LobbyingIndexRow[]> {
  if (!isSupabaseConfigured()) return [];
  const rows = await fetchSupabaseRpcRows<{ client_key: string; client_name: string; spend: string; firms: string; bills: string }>(
    "lobbying_client_index",
    { p_years: `{${currentCongressYears().join(",")}}`, p_limit: String(limit) },
    { cache: "no-store" },
  );
  return rows.map((row) => ({
    clientKey: row.client_key,
    name: displayOrganization(row.client_name),
    spend: num(row.spend),
    firms: num(row.firms),
    bills: num(row.bills),
  }));
}
