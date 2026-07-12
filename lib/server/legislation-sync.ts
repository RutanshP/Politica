import {
  fetchCongressBillActions,
  fetchCongressBillDetail,
  fetchCongressBills,
  fetchCongressBillsByUrl,
  fetchCongressBillSummaries,
  fetchCongressBillTextVersions,
  fetchCongressCommitteeDetail,
  fetchCongressCommittees,
  fetchCongressCommitteesByUrl,
  fetchCongressTextContent,
  getDefaultCongress,
  isCongressBillsConfigured,
} from "@/lib/adapters/congress";
import {
  type FederalVoteRecord,
  fetchHouseRollCallVote,
  fetchSenateRollCallVote,
  normalizeFederalVoteMatchKey,
} from "@/lib/adapters/federal-votes";
import {
  mapBillActionToRow,
  mapBillToRow,
  mapRowToBill,
  mapBillVersionToRow,
  mapCommitteeToRow,
} from "@/lib/normalizers/legislation";
import {
  chooseCongressBillTitle,
  mergeCongressBillDetail,
  normalizeCongressBillListItem,
  parseBillId,
} from "@/lib/normalizers/bills";
import {
  appendStoredBillActions,
  appendStoredBillVersions,
  listStoredBillActionRowsByBillIds,
  listStoredBillVersionRowsByBillIds,
  upsertStoredBills,
} from "@/lib/supabase/bills";
import { replaceStoredCommitteeMemberships, upsertStoredCommittees } from "@/lib/supabase/committees";
import { deleteSupabaseRows, fetchSupabaseRows } from "@/lib/supabase/rest";
import { appendStoredVotes, listStoredVoteHeaders, listStoredVotePositionsByVoteIds } from "@/lib/supabase/votes";
import { buildUpdatedPoliticianRowsFromVotePositions } from "@/lib/server/vote-stats";
import { normalizePersonLookup, slugifySegment } from "@/lib/utils";
import type { Bill, Committee } from "@/types/civic";
import type { CongressCommitteeListItem } from "@/types/congress";
import type { BillActionRow, BillRow, BillVersionRow, CommitteeMemberRow, PoliticianRow, VotePositionRow, VoteRow } from "@/types/supabase";

const LEGISLATION_PAGE_SIZE = Number.parseInt(
  process.env.POLITICA_LEGISLATION_PAGE_SIZE?.trim() || "50",
  10,
);
const LEGISLATION_MAX_BILLS = Number.parseInt(
  process.env.POLITICA_LEGISLATION_MAX_BILLS?.trim() || "0",
  10,
);
const LEGISLATION_DETAIL_CONCURRENCY = Number.parseInt(
  process.env.POLITICA_LEGISLATION_DETAIL_CONCURRENCY?.trim() || "2",
  10,
);
const LEGISLATION_TEXT_VERSION_CONTENT_LIMIT = Number.parseInt(
  process.env.POLITICA_LEGISLATION_TEXT_VERSION_CONTENT_LIMIT?.trim() || "0",
  10,
);
const LEGISLATION_MAX_COMMITTEES = Number.parseInt(
  process.env.POLITICA_LEGISLATION_MAX_COMMITTEES?.trim() || "20",
  10,
);
const LEGISLATION_SYNC_COMMITTEES = /^(1|true|yes)$/i.test(
  process.env.POLITICA_LEGISLATION_SYNC_COMMITTEES?.trim() || "false",
);
const LEGISLATION_SYNC_VOTES = /^(1|true|yes)$/i.test(
  process.env.POLITICA_LEGISLATION_SYNC_VOTES?.trim() || "false",
);
const CONGRESS_DETAIL_PAGE_SIZE = Number.parseInt(
  process.env.POLITICA_CONGRESS_DETAIL_PAGE_SIZE?.trim() || "250",
  10,
);
const FEDERAL_VOTE_BATCH_SIZE = Number.parseInt(
  process.env.POLITICA_FEDERAL_VOTE_BATCH_SIZE?.trim() || "5",
  10,
);
const FEDERAL_VOTE_MAX_CONSECUTIVE_MISSES = Number.parseInt(
  process.env.POLITICA_FEDERAL_VOTE_MAX_CONSECUTIVE_MISSES?.trim() || "6",
  10,
);
const FEDERAL_VOTE_MAX_PER_SESSION = Number.parseInt(
  process.env.POLITICA_FEDERAL_VOTE_MAX_PER_SESSION?.trim() || "600",
  10,
);

function uniqueByKey<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(items.length);
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

function buildPlaceholderCommittee(bill: Bill) {
  return {
    committeeId: bill.committeeId,
    committeeName: bill.committeeName,
  };
}

const CONGRESS_PLACEHOLDER_SUMMARY = "Live Congress.gov bill imported. Rich summaries can be layered in from stored detail records or generated briefs later.";
const FEDERAL_VOTE_PLACEHOLDER_SUMMARY = "Stored federal vote metadata is available even though the linked bill metadata has not been synced yet.";

function stripMarkup(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoParagraphs(value: string) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => stripMarkup(paragraph))
    .filter(Boolean)
    .slice(0, 24);
}

function hasMeaningfulBillSummary(summary?: string) {
  const normalized = (summary || "").trim();
  return Boolean(normalized)
    && normalized !== CONGRESS_PLACEHOLDER_SUMMARY
    && normalized !== FEDERAL_VOTE_PLACEHOLDER_SUMMARY;
}

function hasStoredBillDetail(bill: Bill) {
  return hasMeaningfulBillSummary(bill.summary)
    || bill.actions.length > 1
    || bill.versions.length > 0;
}

async function loadBillVersionContent(
  formats: Array<{ type?: string; url?: string }> | undefined,
) {
  const normalizedFormats = (formats ?? [])
    .filter((format): format is { type: string; url: string } => Boolean(format?.type && format?.url))
    .map((format) => ({
      type: format.type,
      url: format.url,
    }));

  const preferredFormat = normalizedFormats.find((format) => /formatted text|text\/plain|plain text|txt/i.test(format.type))
    || normalizedFormats.find((format) => /html/i.test(format.type))
    || normalizedFormats.find((format) => /xml/i.test(format.type));

  if (!preferredFormat?.url) {
    return {
      content: [
        "Official bill text is available from the source link for this version.",
      ],
      isFullTextAvailable: false,
      sourceUrl: normalizedFormats[0]?.url,
      formats: normalizedFormats,
    };
  }

  try {
    const text = await fetchCongressTextContent(preferredFormat.url);
    const paragraphs = splitIntoParagraphs(text);

    return {
      content: paragraphs.length > 0
        ? paragraphs
        : ["Official bill text was fetched, but no readable body text could be parsed from this version."],
      isFullTextAvailable: paragraphs.length > 0,
      sourceUrl: preferredFormat.url,
      formats: normalizedFormats,
    };
  } catch {
    return {
      content: [
        "Official bill text metadata was synced, but the body could not be fetched from the selected source format.",
      ],
      isFullTextAvailable: false,
      sourceUrl: preferredFormat.url,
      formats: normalizedFormats,
    };
  }
}

function buildMetadataOnlyVersionContent(
  formats: Array<{ type?: string; url?: string }> | undefined,
) {
  const normalizedFormats = (formats ?? [])
    .filter((format): format is { type: string; url: string } => Boolean(format?.type && format?.url))
    .map((format) => ({
      type: format.type,
      url: format.url,
    }));

  return {
    content: [] as string[],
    isFullTextAvailable: false,
    sourceUrl: normalizedFormats[0]?.url,
    formats: normalizedFormats,
  };
}

function chooseBestSummary(
  summaries: Awaited<ReturnType<typeof fetchCongressBillSummaries>> | undefined,
) {
  const items = summaries?.summaries ?? [];
  return items
    .map((item) => item.text?.trim())
    .filter((text): text is string => Boolean(text))
    .sort((left, right) => right.length - left.length)[0];
}

async function fetchAllCongressBillActions(
  congress: string,
  billType: string,
  billNumber: string,
) {
  const actions = [];
  let offset = 0;

  while (true) {
    const payload = await fetchCongressBillActions({
      congress,
      billType,
      billNumber,
      limit: CONGRESS_DETAIL_PAGE_SIZE,
      offset,
    });
    const page = payload.actions ?? [];
    actions.push(...page);

    if (page.length < CONGRESS_DETAIL_PAGE_SIZE || page.length === 0) {
      break;
    }

    offset += CONGRESS_DETAIL_PAGE_SIZE;
  }

  return {
    actions: uniqueByKey(actions, (action) => `${action.actionDate || ""}|${action.text || ""}|${action.type || ""}`),
  };
}

async function fetchAllCongressBillSummaries(
  congress: string,
  billType: string,
  billNumber: string,
) {
  const summaries = [];
  let offset = 0;

  while (true) {
    const payload = await fetchCongressBillSummaries({
      congress,
      billType,
      billNumber,
      limit: CONGRESS_DETAIL_PAGE_SIZE,
      offset,
    });
    const page = payload.summaries ?? [];
    summaries.push(...page);

    if (page.length < CONGRESS_DETAIL_PAGE_SIZE || page.length === 0) {
      break;
    }

    offset += CONGRESS_DETAIL_PAGE_SIZE;
  }

  return {
    summaries: uniqueByKey(summaries, (summary) => `${summary.updateDate || ""}|${summary.versionCode || ""}|${summary.text || ""}`),
  };
}

async function fetchAllCongressBills(options?: {
  offset?: number;
  limit?: number;
}) {
  const bills = [];
  const pageSize = LEGISLATION_PAGE_SIZE;
  const requestedLimit = options?.limit;
  const maxBills = requestedLimit && requestedLimit > 0
    ? requestedLimit
    : LEGISLATION_MAX_BILLS > 0
      ? LEGISLATION_MAX_BILLS
      : Number.POSITIVE_INFINITY;
  let offset = options?.offset ?? 0;

  while (bills.length < maxBills) {
    const page = await fetchCongressBills({
      congress: getDefaultCongress(),
      limit: pageSize,
      offset,
    });
    bills.push(...page);

    if (page.length < pageSize || page.length === 0) {
      break;
    }

    offset += pageSize;
  }

  return bills.slice(0, maxBills);
}

function buildCongressListItemFromDetail(
  detailPayload: Awaited<ReturnType<typeof fetchCongressBillDetail>>,
): NonNullable<Awaited<ReturnType<typeof fetchCongressBills>>[number]> | null {
  const detail = detailPayload.bill;
  if (!detail?.type || !detail.number) {
    return null;
  }

  const sponsor = Array.isArray(detail.sponsors) ? detail.sponsors[0] : undefined;
  const titles = Array.isArray(detail.titles)
    ? detail.titles
    : detail.titles
      ? [detail.titles]
      : [];

  return {
    congress: detail.congress,
    type: detail.type,
    number: detail.number,
    title: titles[0]?.title,
    originChamber: detail.originChamber,
    latestAction: detail.latestAction,
    policyArea: detail.policyArea,
    sponsors: sponsor ? [sponsor] : [],
  };
}

async function fetchTargetCongressBills(
  congress: string,
  targetBillIds: string[],
) {
  const results = await Promise.all(
    uniqueByKey(targetBillIds, (value) => value).map(async (billId) => {
      const parsed = parseBillId(billId);
      if (!parsed) {
        throw new Error(`Invalid target bill id: ${billId}`);
      }

      const detail = await fetchCongressBillDetail({
        congress,
        billType: parsed.billType,
        billNumber: parsed.billNumber,
      });
      const listItem = buildCongressListItemFromDetail(detail);
      if (!listItem) {
        throw new Error(`Congress detail payload missing bill fields for ${billId}`);
      }

      return listItem;
    }),
  );

  return results;
}

async function fetchAllCommitteeBills(url: string) {
  const bills = [];
  const pageSize = LEGISLATION_PAGE_SIZE;
  const maxBills = LEGISLATION_MAX_BILLS > 0 ? LEGISLATION_MAX_BILLS : Number.POSITIVE_INFINITY;
  let offset = 0;

  while (bills.length < maxBills) {
    const page = await fetchCongressBillsByUrl(url, {
      limit: pageSize,
      offset,
    });
    bills.push(...page);

    if (page.length < pageSize || page.length === 0) {
      break;
    }

    offset += pageSize;
  }

  return bills.slice(0, maxBills);
}

function buildQuotedInFilter(values: string[]) {
  return values
    .map((value) => `"${value.replace(/"/g, '\\"')}"`)
    .join(",");
}

function isCongressSourceBillRow(row: BillRow) {
  const sourceSystem = (row.source_system || "").trim().toLowerCase();
  const source = (row.source || "").trim().toLowerCase();
  return sourceSystem === "congress" || source === "congress_sync";
}

async function fetchRowsByBillIdsInChunks<TRow>(
  pathname: string,
  billIds: string[],
  orderQuery?: string,
) {
  if (billIds.length === 0) {
    return [] as TRow[];
  }

  const chunkSize = 100;
  const rows: TRow[] = [];

  for (let index = 0; index < billIds.length; index += chunkSize) {
    const chunk = billIds.slice(index, index + chunkSize);
    const filter = buildQuotedInFilter(chunk);
    const query = [
      `bill_id=in.(${filter})`,
      orderQuery,
    ].filter(Boolean).join("&");
    const result = await fetchSupabaseRows<TRow>(pathname, query, { cache: "no-store", paginateAll: true });
    rows.push(...result);
  }

  return rows;
}

async function loadExistingStoredBills(congressSession: string) {
  const billSelect = [
    "id",
    "slug",
    "number",
    "title",
    "summary",
    "jurisdiction",
    "country",
    "state",
    "chamber",
    "status",
    "topic",
    "sponsor_id",
    "sponsor_name",
    "committee_id",
    "committee_name",
    "latest_action",
    "last_action_at",
    "introduced_at",
    "session",
    "chance_of_passing",
    "stats",
    "related_bill_ids",
    "source",
    "source_system",
    "source_id",
    "jurisdiction_type",
    "state_code",
    "session_id",
    "synced_at",
    "raw_bill",
  ].join(",");

  const billRows = await fetchSupabaseRows<BillRow>(
    "bills",
    `jurisdiction_type=eq.federal&session=eq.${encodeURIComponent(congressSession)}&order=id.asc`,
    { cache: "no-store", select: billSelect, paginateAll: true },
  );

  const billIds = billRows.map((row) => row.id);
  const [actionRows, versionRows, voteRows] = await Promise.all([
    fetchRowsByBillIdsInChunks<BillActionRow>("bill_actions", billIds, "order=bill_id.asc,sort_order.asc"),
    fetchRowsByBillIdsInChunks<BillVersionRow>("bill_versions", billIds, "order=bill_id.asc,sort_order.asc"),
    fetchRowsByBillIdsInChunks<Pick<VoteRow, "bill_id">>("votes", billIds, "order=bill_id.asc"),
  ]);

  const actionsByBillId = new Map<string, BillActionRow[]>();
  for (const row of actionRows) {
    const items = actionsByBillId.get(row.bill_id) || [];
    items.push(row);
    actionsByBillId.set(row.bill_id, items);
  }

  const versionsByBillId = new Map<string, BillVersionRow[]>();
  for (const row of versionRows) {
    const items = versionsByBillId.get(row.bill_id) || [];
    items.push(row);
    versionsByBillId.set(row.bill_id, items);
  }

  const billsById = new Map<string, Bill>();
  const billRowsById = new Map<string, BillRow>();
  billRows.forEach((row) => {
    billsById.set(row.id, mapRowToBill(row, actionsByBillId.get(row.id) || [], versionsByBillId.get(row.id) || []));
    billRowsById.set(row.id, row);
  });

  return {
    billRows,
    billRowsById,
    billsById,
    voteBillIds: new Set(voteRows.map((row) => row.bill_id)),
  };
}

async function loadStoredBillsByIds(billIds: string[]) {
  const uniqueBillIds = [...new Set(billIds.filter(Boolean))];
  if (uniqueBillIds.length === 0) {
    return {
      billRows: [] as BillRow[],
      billRowsById: new Map<string, BillRow>(),
      billsById: new Map<string, Bill>(),
      voteBillIds: new Set<string>(),
    };
  }

  const billSelect = [
    "id",
    "slug",
    "number",
    "title",
    "summary",
    "jurisdiction",
    "country",
    "state",
    "chamber",
    "status",
    "topic",
    "sponsor_id",
    "sponsor_name",
    "committee_id",
    "committee_name",
    "latest_action",
    "last_action_at",
    "introduced_at",
    "session",
    "chance_of_passing",
    "stats",
    "related_bill_ids",
    "source",
    "source_system",
    "source_id",
    "jurisdiction_type",
    "state_code",
    "session_id",
    "synced_at",
    "raw_bill",
  ].join(",");

  const chunkSize = 100;
  const billRows: BillRow[] = [];
  for (let index = 0; index < uniqueBillIds.length; index += chunkSize) {
    const chunk = uniqueBillIds.slice(index, index + chunkSize);
    const filter = buildQuotedInFilter(chunk);
    const result = await fetchSupabaseRows<BillRow>(
      "bills",
      `id=in.(${filter})&order=id.asc`,
      { cache: "no-store", select: billSelect, paginateAll: true },
    );
    billRows.push(...result);
  }

  const [actionRows, versionRows] = await Promise.all([
    fetchRowsByBillIdsInChunks<BillActionRow>("bill_actions", uniqueBillIds, "order=bill_id.asc,sort_order.asc"),
    fetchRowsByBillIdsInChunks<BillVersionRow>("bill_versions", uniqueBillIds, "order=bill_id.asc,sort_order.asc"),
  ]);

  const actionsByBillId = new Map<string, BillActionRow[]>();
  for (const row of actionRows) {
    const items = actionsByBillId.get(row.bill_id) || [];
    items.push(row);
    actionsByBillId.set(row.bill_id, items);
  }

  const versionsByBillId = new Map<string, BillVersionRow[]>();
  for (const row of versionRows) {
    const items = versionsByBillId.get(row.bill_id) || [];
    items.push(row);
    versionsByBillId.set(row.bill_id, items);
  }

  const billsById = new Map<string, Bill>();
  const billRowsById = new Map<string, BillRow>();
  billRows.forEach((row) => {
    billsById.set(row.id, mapRowToBill(row, actionsByBillId.get(row.id) || [], versionsByBillId.get(row.id) || []));
    billRowsById.set(row.id, row);
  });

  return {
    billRows,
    billRowsById,
    billsById,
    voteBillIds: new Set<string>(),
  };
}

function buildStaleCongressBillIds(
  existingBillRows: BillRow[],
  canonicalBillIds: Set<string>,
  voteBillIds: Set<string>,
  congressSession: string,
) {
  return existingBillRows
    .filter((row) =>
      row.jurisdiction_type === "federal"
      && row.session === congressSession
      && isCongressSourceBillRow(row)
      && !canonicalBillIds.has(row.id)
      && !voteBillIds.has(row.id))
    .map((row) => row.id);
}

async function deleteBillArtifacts(billIds: string[]) {
  const chunkSize = 100;

  for (let index = 0; index < billIds.length; index += chunkSize) {
    const chunk = billIds.slice(index, index + chunkSize);
    const filter = buildQuotedInFilter(chunk);
    await deleteSupabaseRows("bill_actions", `bill_id=in.(${filter})`);
    await deleteSupabaseRows("bill_versions", `bill_id=in.(${filter})`);
    await deleteSupabaseRows("bills", `id=in.(${filter})`);
  }
}

function getErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Unknown legislation sync error";
  }

  if (error.name === "TimeoutError" || /aborted|timeout/i.test(error.message)) {
    return "Legislation sync timed out while fetching upstream data. Retry the sync; if it repeats, reduce upstream batch size or check provider/network health.";
  }

  const cause = error.cause as { code?: string; hostname?: string } | undefined;
  if (cause?.code === "ENOTFOUND" && cause.hostname === "api.congress.gov") {
    return "Congress.gov could not be reached from this machine. Check DNS/network access to api.congress.gov.";
  }

  return error.message;
}

function normalizeCommitteeRecord(
  committee: CongressCommitteeListItem,
  detail: Awaited<ReturnType<typeof fetchCongressCommitteeDetail>> | undefined,
  activeBillIds: string[],
): Committee {
  const name = detail?.committee?.history?.[0]?.officialName || committee.name || "Congressional Committee";
  const chamber = committee.chamber || detail?.committee?.chamber || "Congress";
  const committeeId = committee.systemCode || slugifySegment(`${chamber}-${name}`);
  const committeeSlug = slugifySegment(`${chamber}-${name}-${committeeId}`);

  return {
    id: committeeId,
    slug: committeeSlug,
    name,
    chamber,
    jurisdiction: detail?.committee?.jurisdiction || "Congressional jurisdiction details not provided by the source.",
    chair: detail?.committee?.chair || "Chair roster not connected from Congress.gov yet",
    rankingMember: detail?.committee?.rankingMember || "Ranking member roster not connected from Congress.gov yet",
    description: `Synced from Congress.gov committee records for the ${chamber}.`,
    hearing: "Hearing calendar sync not connected yet",
    activeBillIds,
    memberIds: [],
    contactUrl: detail?.committee?.website || committee.url,
    contactPhone: detail?.committee?.phone,
    contactAddress: detail?.committee?.address,
    subcommittees: (detail?.committee?.subcommittees ?? []).map((item) => ({
      name: item.name || "Subcommittee",
      systemCode: item.systemCode,
    })),
  };
}

function getCongressStartYear(congress: string) {
  const numericCongress = Number.parseInt(congress, 10);
  if (!Number.isFinite(numericCongress)) {
    return new Date().getUTCFullYear();
  }

  return 1789 + (numericCongress - 1) * 2;
}

function normalizePartyCode(value?: string | null) {
  const normalized = (value || "").trim().toUpperCase();
  if (!normalized) return "";
  if (normalized.startsWith("D")) return "D";
  if (normalized.startsWith("R")) return "R";
  if (normalized.startsWith("I")) return "I";
  return normalized.slice(0, 1);
}

function buildNameVariants(value?: string | null) {
  const normalized = normalizePersonLookup(value);
  if (!normalized) {
    return [];
  }

  const tokens = normalized.split(" ").filter(Boolean);
  const variants = new Set<string>([normalized]);

  if (tokens.length >= 3) {
    variants.add([tokens[0], tokens[tokens.length - 1]].join(" "));
  }

  return [...variants];
}

function buildFederalPoliticianLookup(rows: PoliticianRow[]) {
  const byId = new Map<string, string>();
  const byMatchKey = new Map<string, string>();

  rows
    .filter((row) => row.jurisdiction_type === "federal")
    .forEach((row) => {
      byId.set(row.id, row.id);

      const rawMember = (row.raw_member ?? row.raw_payload ?? {}) as Record<string, unknown>;
      const candidateNames = new Set<string>([
        row.name,
        typeof rawMember.directOrderName === "string" ? rawMember.directOrderName : "",
        typeof rawMember.invertedOrderName === "string"
          ? rawMember.invertedOrderName.split(",").reverse().join(" ").trim()
          : "",
        [rawMember.firstName, rawMember.lastName]
          .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
          .join(" "),
        [rawMember.firstName, rawMember.middleName, rawMember.lastName]
          .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
          .join(" "),
      ].filter(Boolean));

      const stateCode = (row.state_code || "").trim().toUpperCase();
      const partyCode = normalizePartyCode(
        typeof rawMember.partyName === "string"
          ? rawMember.partyName
          : Array.isArray(rawMember.partyHistory)
            ? ((rawMember.partyHistory[0] as { partyAbbreviation?: string } | undefined)?.partyAbbreviation || row.party)
            : row.party,
      );

      candidateNames.forEach((name) => {
        buildNameVariants(name).forEach((variant) => {
          const key = normalizeFederalVoteMatchKey({
            name: variant,
            state: stateCode,
            party: partyCode,
          });
          if (key && !byMatchKey.has(key)) {
            byMatchKey.set(key, row.id);
          }
        });
      });
    });

  return { byId, byMatchKey };
}

async function collectFederalHouseVotes(congress: string) {
  const startYear = getCongressStartYear(congress);
  const years = [startYear, startYear + 1];
  const votes = [];

  for (const [index, year] of years.entries()) {
    let nextRollCall = 1;
    let consecutiveMisses = 0;

    while (nextRollCall <= FEDERAL_VOTE_MAX_PER_SESSION && consecutiveMisses < FEDERAL_VOTE_MAX_CONSECUTIVE_MISSES) {
      const batch = Array.from({ length: FEDERAL_VOTE_BATCH_SIZE }, (_, index) => nextRollCall + index);
      const results = await Promise.all(batch.map((rollCallNumber) => fetchHouseRollCallVote(year, rollCallNumber)));

      for (const result of results) {
        if (result) {
          votes.push(result);
          consecutiveMisses = 0;
        } else {
          consecutiveMisses += 1;
        }
      }

      nextRollCall += FEDERAL_VOTE_BATCH_SIZE;
    }
  }

  return votes;
}

async function collectFederalSenateVotes(congress: string) {
  const votes = [];

  for (const session of [1, 2] as const) {
    let nextVote = 1;
    let consecutiveMisses = 0;

    while (nextVote <= FEDERAL_VOTE_MAX_PER_SESSION && consecutiveMisses < FEDERAL_VOTE_MAX_CONSECUTIVE_MISSES) {
      const batch = Array.from({ length: FEDERAL_VOTE_BATCH_SIZE }, (_, index) => nextVote + index);
      const results = await Promise.all(batch.map((voteNumber) => fetchSenateRollCallVote(congress, session, voteNumber)));

      for (const result of results) {
        if (result) {
          votes.push(result);
          consecutiveMisses = 0;
        } else {
          consecutiveMisses += 1;
        }
      }

      nextVote += FEDERAL_VOTE_BATCH_SIZE;
    }
  }

  return votes;
}

function parseStoredHouseVoteId(voteId: string) {
  const match = voteId.match(/^house-(\d+)-(\d+)-(\d+)$/i);
  if (!match) return null;
  return {
    congress: match[1],
    session: Number.parseInt(match[2], 10),
    rollCall: Number.parseInt(match[3], 10),
  };
}

function parseStoredSenateVoteId(voteId: string) {
  const match = voteId.match(/^senate-(\d+)-(\d+)-(\d+)$/i);
  if (!match) return null;
  return {
    congress: match[1],
    session: Number.parseInt(match[2], 10),
    voteNumber: Number.parseInt(match[3], 10),
  };
}

function buildExistingFederalVoteCursor(
  congress: string,
  existingVoteRows: Array<Pick<VoteRow, "id" | "source_system">>,
) {
  const houseBySession = new Map<number, number>();
  const senateBySession = new Map<number, number>();

  existingVoteRows.forEach((row) => {
    if (row.source_system === "house_clerk") {
      const parsed = parseStoredHouseVoteId(row.id);
      if (!parsed || parsed.congress !== congress) {
        return;
      }

      houseBySession.set(
        parsed.session,
        Math.max(houseBySession.get(parsed.session) || 0, parsed.rollCall),
      );
      return;
    }

    if (row.source_system === "senate_lis") {
      const parsed = parseStoredSenateVoteId(row.id);
      if (!parsed || parsed.congress !== congress) {
        return;
      }

      senateBySession.set(
        parsed.session,
        Math.max(senateBySession.get(parsed.session) || 0, parsed.voteNumber),
      );
    }
  });

  return {
    houseBySession,
    senateBySession,
  };
}

async function collectIncrementalFederalHouseVotes(
  congress: string,
  cursor: ReturnType<typeof buildExistingFederalVoteCursor>,
) {
  const startYear = getCongressStartYear(congress);
  const years = [startYear, startYear + 1];
  const votes = [];

  for (const [index, year] of years.entries()) {
    const session = index + 1;
    let nextRollCall = (cursor.houseBySession.get(session) || 0) + 1;
    let consecutiveMisses = 0;

    while (nextRollCall <= FEDERAL_VOTE_MAX_PER_SESSION && consecutiveMisses < FEDERAL_VOTE_MAX_CONSECUTIVE_MISSES) {
      const batch = Array.from({ length: FEDERAL_VOTE_BATCH_SIZE }, (_, batchIndex) => nextRollCall + batchIndex);
      const results = await Promise.all(batch.map((rollCallNumber) => fetchHouseRollCallVote(year, rollCallNumber)));

      for (const result of results) {
        if (result) {
          votes.push(result);
          consecutiveMisses = 0;
        } else {
          consecutiveMisses += 1;
        }
      }

      nextRollCall += FEDERAL_VOTE_BATCH_SIZE;
    }
  }

  return votes;
}

async function collectIncrementalFederalSenateVotes(
  congress: string,
  cursor: ReturnType<typeof buildExistingFederalVoteCursor>,
) {
  const votes = [];

  for (const session of [1, 2] as const) {
    let nextVote = (cursor.senateBySession.get(session) || 0) + 1;
    let consecutiveMisses = 0;

    while (nextVote <= FEDERAL_VOTE_MAX_PER_SESSION && consecutiveMisses < FEDERAL_VOTE_MAX_CONSECUTIVE_MISSES) {
      const batch = Array.from({ length: FEDERAL_VOTE_BATCH_SIZE }, (_, index) => nextVote + index);
      const results = await Promise.all(batch.map((voteNumber) => fetchSenateRollCallVote(congress, session, voteNumber)));

      for (const result of results) {
        if (result) {
          votes.push(result);
          consecutiveMisses = 0;
        } else {
          consecutiveMisses += 1;
        }
      }

      nextVote += FEDERAL_VOTE_BATCH_SIZE;
    }
  }

  return votes;
}

function buildFederalVoteRows(
  votes: FederalVoteRecord[],
  bills: Bill[],
  lookup: ReturnType<typeof buildFederalPoliticianLookup>,
) {
  const billById = new Map(bills.map((bill) => [bill.id, bill]));

  const voteRows: VoteRow[] = [];
  const positionRows: VotePositionRow[] = [];

  votes.forEach((vote) => {
    const linkedBill = vote.billId ? billById.get(vote.billId) : undefined;
    const voteId = vote.id;

    voteRows.push({
      id: voteId,
      bill_id: linkedBill?.id || vote.billId || voteId,
      canonical_id: vote.canonicalId,
      bill_number: linkedBill?.number || vote.billNumber,
      title: linkedBill?.title || vote.title,
      chamber: vote.chamber,
      date_label: vote.dateLabel,
      result: vote.result,
      yea: vote.yea,
      nay: vote.nay,
      present: vote.present,
      not_voting: vote.notVoting,
      source_system: vote.sourceSystem,
      source_id: vote.sourceId,
      synced_at: new Date().toISOString(),
      raw_payload: vote.rawPayload,
    });

    vote.positions.forEach((position) => {
      const matchedPoliticianId = position.politicianId && lookup.byId.has(position.politicianId)
        ? position.politicianId
        : lookup.byMatchKey.get(normalizeFederalVoteMatchKey({
          name: position.name,
          state: position.state,
          party: normalizePartyCode(position.party),
        })) || position.politicianId || `unmatched-${vote.sourceSystem}-${slugifySegment(`${position.name}-${position.state}`)}`;

      positionRows.push({
        vote_id: voteId,
        politician_id: matchedPoliticianId,
        name: position.name,
        party: position.party,
        state: position.state,
        vote: position.vote,
        source_system: vote.sourceSystem,
        source_id: `${voteId}-${position.externalId || slugifySegment(position.name)}`,
        synced_at: new Date().toISOString(),
        raw_payload: position,
      });
    });
  });

  return { voteRows, positionRows };
}

function buildFederalVotePlaceholderBillRows(
  existingBillRows: BillRow[],
  voteRows: VoteRow[],
) {
  const existingBillIds = new Set(existingBillRows.map((row) => row.id));

  return uniqueByKey(
    voteRows
      .filter((voteRow) => !existingBillIds.has(voteRow.bill_id))
      .map((voteRow) => ({
        id: voteRow.bill_id,
        slug: slugifySegment(`${voteRow.bill_number}-${voteRow.title || voteRow.bill_id}`),
        number: voteRow.bill_number || voteRow.bill_id.toUpperCase(),
        title: voteRow.title || "Federal vote record",
        summary: "Stored federal vote metadata is available even though the linked bill metadata has not been synced yet.",
        jurisdiction: "Federal" as const,
        country: "United States",
        state: null,
        chamber: voteRow.chamber,
        status: "On Floor" as const,
        topic: "Congressional Vote",
        sponsor_id: "federal-vote-pending",
        sponsor_name: "Congressional sponsor metadata pending bill sync",
        committee_id: "federal-vote-pending",
        committee_name: "Committee metadata pending bill sync",
        latest_action: voteRow.result,
        last_action_at: voteRow.date_label,
        introduced_at: voteRow.date_label,
        session: `${getDefaultCongress()}th Congress`,
        chance_of_passing: 50,
        stats: {
          amendments: 0,
          cosponsors: 0,
          votes: 1,
          bipartisanScore: 0,
        },
        related_bill_ids: [],
        source: "congress_sync",
        source_system: voteRow.source_system,
        source_id: voteRow.bill_id,
        jurisdiction_type: "federal" as const,
        state_code: null,
        session_id: null,
        synced_at: new Date().toISOString(),
        raw_payload: voteRow.raw_payload,
        raw_bill: voteRow.raw_payload,
      })),
    (row) => row.id,
  );
}

function buildMissingFederalPoliticianRows(
  existingRows: PoliticianRow[],
  positionRows: VotePositionRow[],
) {
  const existingIds = new Set(existingRows.map((row) => row.id));

  return uniqueByKey(
    positionRows
      .filter((row) => !existingIds.has(row.politician_id))
      .map((row) => ({
        id: row.politician_id,
        slug: slugifySegment(`federal-${row.state}-${row.name}-${row.politician_id}`),
        name: row.name,
        title: "US Legislator",
        party: row.party || "Unknown",
        state: row.state || "Unknown",
        district: null,
        biography: "Placeholder federal legislator record created from official roll-call vote data.",
        born: "Not available from configured sources",
        education: "Not available from configured sources",
        occupation: "Public official",
        website: "Not available from configured sources",
        office_phone: "Not available from configured sources",
        office_address: "Not available from configured sources",
        next_election: "Federal election calendar not connected",
        stats: {
          votesWithParty: 0,
          votesAgainstParty: 0,
          attendance: 0,
          billsIntroduced: 0,
          billsPassed: 0,
          amendmentsOffered: 0,
        },
        ideology: {},
        source: "congress_sync",
        source_system: "federal_votes",
        source_id: row.politician_id,
        jurisdiction_type: "federal" as const,
        state_code: row.state || null,
        session_id: null,
        synced_at: new Date().toISOString(),
        raw_payload: row.raw_payload,
        raw_member: row.raw_payload,
      })),
    (row) => row.id,
  );
}

function buildFederalCommitteeMembershipRows(
  committees: Committee[],
  politicians: PoliticianRow[],
): CommitteeMemberRow[] {
  const normalizedPoliticians = politicians.map((politician) => ({
    id: politician.id,
    name: politician.name,
    normalized: politician.name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(),
  }));

  const rows: CommitteeMemberRow[] = [];

  committees.forEach((committee) => {
    [
      { role: "chair", name: committee.chair, sortOrder: 0 },
      { role: "ranking-member", name: committee.rankingMember, sortOrder: 1 },
    ].forEach((entry) => {
      const normalizedName = entry.name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      if (!normalizedName || normalizedName.includes("not connected")) {
        return;
      }

      const politician = normalizedPoliticians.find((candidate) => candidate.normalized === normalizedName);
      if (!politician) {
        return;
      }

      rows.push({
        committee_id: committee.id,
        politician_id: politician.id,
        role: entry.role,
        sort_order: entry.sortOrder,
        source_system: "congress",
        source_id: `${committee.id}:${politician.id}:${entry.role}`,
        synced_at: new Date().toISOString(),
        raw_payload: {
          committeeId: committee.id,
          politicianId: politician.id,
          role: entry.role,
          matchedBy: "leadership-name",
        },
      });
    });
  });

  return uniqueByKey(rows, (row) => `${row.committee_id}:${row.politician_id}`);
}

export async function syncLegislationFromCongress(options?: {
  targetBillIds?: string[];
  syncCommittees?: boolean;
  syncVotes?: boolean;
  listOffset?: number;
  listLimit?: number;
}) {
  if (!isCongressBillsConfigured()) {
    throw new Error("Congress API is not configured");
  }

  try {
    const congress = getDefaultCongress();
    const congressSession = `${congress}th Congress`;
    const syncCommittees = options?.syncCommittees ?? LEGISLATION_SYNC_COMMITTEES;
    const syncVotes = options?.syncVotes ?? LEGISLATION_SYNC_VOTES;
    const listBills = options?.targetBillIds?.length
      ? await fetchTargetCongressBills(congress, options.targetBillIds)
      : await fetchAllCongressBills({
        offset: options?.listOffset,
        limit: options?.listLimit,
      });
    const shouldPruneStaleBills = !options?.targetBillIds?.length && !options?.listLimit && !options?.listOffset;
    const requestedBillIds = [...new Set(listBills.map((bill) => normalizeCongressBillListItem(bill).id))];
    const existingStored = shouldPruneStaleBills
      ? await loadExistingStoredBills(congressSession)
      : await loadStoredBillsByIds(requestedBillIds);
    const existingDetailedBillsById = new Map<string, Bill>();
    existingStored.billRows
      .filter((row) =>
        row.jurisdiction_type === "federal"
        && row.session === congressSession
        && isCongressSourceBillRow(row))
      .forEach((row) => {
        const existingBill = existingStored.billsById.get(row.id);
        if (existingBill && hasStoredBillDetail(existingBill)) {
          existingDetailedBillsById.set(row.id, existingBill);
        }
      });
    const detailFailures: Array<{ billId: string; reason: string }> = [];
    let detailedBillsSynced = 0;
    let preservedBills = 0;

    const billResults = await mapWithConcurrency(
      listBills,
      LEGISLATION_DETAIL_CONCURRENCY,
      async (listBill) => {
        const seed = normalizeCongressBillListItem(listBill);
        const parsed = parseBillId(seed.id);

        if (!parsed) {
          return {
            bill: seed,
            rawBill: listBill,
            status: "seed" as const,
          };
        }

        try {
          const [detail, actions, summaries, textVersions] = await Promise.all([
            fetchCongressBillDetail({
              congress,
              billType: parsed.billType,
              billNumber: parsed.billNumber,
            }),
            fetchAllCongressBillActions(
              congress,
              parsed.billType,
              parsed.billNumber,
            ).catch(() => undefined),
            fetchAllCongressBillSummaries(
              congress,
              parsed.billType,
              parsed.billNumber,
            ).catch(() => undefined),
            fetchCongressBillTextVersions({
              congress,
              billType: parsed.billType,
              billNumber: parsed.billNumber,
            }).catch(() => undefined),
          ]);
          const committeeList = detail.bill?.committees?.url
            ? await fetchCongressCommitteesByUrl(detail.bill.committees.url, { limit: 10 }).catch(() => [])
            : [];

          const merged = mergeCongressBillDetail(seed, detail, actions, textVersions);
          const hydratedVersions = await Promise.all(
            merged.versions.map(async (version, index) => {
              const rawVersion = textVersions?.textVersions?.[index];
              const shouldFetchBody = index < Math.max(0, LEGISLATION_TEXT_VERSION_CONTENT_LIMIT);
              const loaded = shouldFetchBody
                ? await loadBillVersionContent(rawVersion?.formats)
                : buildMetadataOnlyVersionContent(rawVersion?.formats);

              return {
                ...version,
                content: loaded.content,
                sourceUrl: loaded.sourceUrl,
                formats: loaded.formats,
                isFullTextAvailable: loaded.isFullTextAvailable,
              };
            }),
          );
          const linkedCommittee = committeeList[0];
          const committeeData = linkedCommittee
            ? {
                committeeId: linkedCommittee.systemCode || slugifySegment(linkedCommittee.name || "committee"),
                committeeName: linkedCommittee.name || "Congressional Committee",
              }
            : buildPlaceholderCommittee(merged);
          const bestSummary = chooseBestSummary(summaries);
          const resolvedTitle = chooseCongressBillTitle(
            Array.isArray(detail.bill?.titles)
              ? detail.bill.titles
              : detail.bill?.titles
                ? [detail.bill.titles]
                : [],
            merged.title,
            bestSummary,
          );

          detailedBillsSynced += 1;
          return {
            bill: {
              ...merged,
              title: resolvedTitle,
              summary: bestSummary || merged.summary,
              versions: hydratedVersions,
              ...committeeData,
            },
            rawBill: detail.bill || listBill,
            status: "detailed" as const,
          };
        } catch (error) {
          detailFailures.push({
            billId: seed.id,
            reason: getErrorMessage(error),
          });

          const existingDetailed = existingDetailedBillsById.get(seed.id);
          if (existingDetailed) {
            preservedBills += 1;
            return {
              bill: existingDetailed,
              rawBill: existingStored.billRowsById.get(seed.id)?.raw_bill || listBill,
              status: "preserved" as const,
            };
          }

          return {
            bill: seed,
            rawBill: listBill,
            status: "seed" as const,
          };
        }
      },
    );

    if (detailedBillsSynced === 0) {
      const sampleReasons = detailFailures
        .slice(0, 3)
        .map((entry) => `${entry.billId}: ${entry.reason}`)
        .join(" | ");
      throw new Error(
        sampleReasons
          ? `No canonical detailed Congress bills were refreshed during this sync run. Sample failures: ${sampleReasons}`
          : "No canonical detailed Congress bills were refreshed during this sync run.",
      );
    }

    const committees = syncCommittees
      ? await Promise.all(
        (await Promise.all([
          fetchCongressCommittees({ congress, chamber: "senate", limit: LEGISLATION_MAX_COMMITTEES }),
          fetchCongressCommittees({ congress, chamber: "house", limit: LEGISLATION_MAX_COMMITTEES }),
          fetchCongressCommittees({ congress, chamber: "joint", limit: 10 }).catch(() => []),
        ]))
          .flat()
          .slice(0, LEGISLATION_MAX_COMMITTEES)
          .map(async (committee) => {
            try {
              const detail = await fetchCongressCommitteeDetail({
                congress,
                chamber: committee.chamber || "house",
                systemCode: committee.systemCode || slugifySegment(committee.name || "committee"),
              });
              const activeBillIds = detail.committee?.bills?.url
                ? (await fetchAllCommitteeBills(detail.committee.bills.url))
                  .map(normalizeCongressBillListItem)
                  .map((bill) => bill.id)
                : [];

              return {
                committee: normalizeCommitteeRecord(committee, detail, activeBillIds),
                rawCommittee: detail.committee || committee,
              };
            } catch {
              return {
                committee: normalizeCommitteeRecord(committee, undefined, []),
                rawCommittee: committee,
              };
            }
          }),
      )
      : [];

    const committeeByBillId = new Map<string, Committee>();
    for (const entry of committees) {
      for (const billId of entry.committee.activeBillIds) {
        if (!committeeByBillId.has(billId)) {
          committeeByBillId.set(billId, entry.committee);
        }
      }
    }

    const finalBills = billResults.map(({ bill, rawBill }) => {
      const committee = committeeByBillId.get(bill.id);

      return {
        bill: committee
          ? {
              ...bill,
              committeeId: committee.id,
              committeeName: committee.name,
            }
          : bill,
        rawBill,
      };
    });

    const relatedByTopic = new Map<string, Bill[]>();
    for (const { bill } of finalBills) {
      const items = relatedByTopic.get(bill.topic) || [];
      items.push(bill);
      relatedByTopic.set(bill.topic, items);
    }

    const finalizedBills = finalBills.map(({ bill, rawBill }) => {
      const relatedBillIds = (relatedByTopic.get(bill.topic) || [])
        .filter((candidate) => candidate.id !== bill.id)
        .slice(0, 3)
        .map((candidate) => candidate.id);

      return {
        bill: {
          ...bill,
          relatedBillIds,
        },
        rawBill,
      };
    });

    const storedPoliticianRows = syncVotes
      ? await fetchSupabaseRows<PoliticianRow>(
        "politicians",
        "jurisdiction_type=eq.federal&order=name.asc",
        { cache: "no-store" },
      ).catch(() => [])
      : [];
    const existingFederalVoteRows = syncVotes
      ? await listStoredVoteHeaders().catch(() => [])
      : [];
    const existingFederalVoteCursor = buildExistingFederalVoteCursor(
      congress,
      existingFederalVoteRows
        .filter((row) => row.source_system === "house_clerk" || row.source_system === "senate_lis"),
    );
    const politicianLookup = buildFederalPoliticianLookup(storedPoliticianRows);
    let voteRows: VoteRow[] = [];
    let positionRows: VotePositionRow[] = [];
    let updatedPoliticianRows: PoliticianRow[] = [];
    let placeholderPoliticianRows: PoliticianRow[] = [];
    let voteSyncWarning: string | undefined;

    if (syncVotes) {
      try {
        const federalVotes = uniqueByKey(
          [
            ...(await collectIncrementalFederalHouseVotes(congress, existingFederalVoteCursor)),
            ...(await collectIncrementalFederalSenateVotes(congress, existingFederalVoteCursor)),
          ],
          (vote) => vote.id,
        );

        const voteBundle = buildFederalVoteRows(
          federalVotes,
          finalizedBills.map(({ bill }) => bill),
          politicianLookup,
        );
        voteRows = voteBundle.voteRows;
        positionRows = voteBundle.positionRows;

        const existingPositionRows = await listStoredVotePositionsByVoteIds(
          existingFederalVoteRows
            .filter((row) => row.source_system === "house_clerk" || row.source_system === "senate_lis")
            .map((row) => row.id),
        ).catch(() => []);
        const combinedPositionRows = [...existingPositionRows, ...positionRows];
        updatedPoliticianRows = buildUpdatedPoliticianRowsFromVotePositions(
          storedPoliticianRows.filter((row) => row.jurisdiction_type === "federal"),
          combinedPositionRows,
        );
        placeholderPoliticianRows = buildMissingFederalPoliticianRows(storedPoliticianRows, combinedPositionRows);
      } catch (error) {
        voteSyncWarning = getErrorMessage(error);
      }
    }
    const allFederalPoliticianRows = uniqueByKey(
      [...storedPoliticianRows, ...updatedPoliticianRows, ...placeholderPoliticianRows],
      (row) => row.id,
    );
    const committeeMembershipRows = buildFederalCommitteeMembershipRows(
      committees.map((entry) => entry.committee),
      allFederalPoliticianRows,
    );

    const committeesWithMembers = committees.map((entry) => ({
      ...entry,
      committee: {
        ...entry.committee,
        memberIds: committeeMembershipRows
          .filter((row) => row.committee_id === entry.committee.id)
          .sort((left, right) => left.sort_order - right.sort_order)
          .map((row) => row.politician_id),
      },
    }));

    const syncedBillRows = uniqueByKey(
      finalizedBills.map(({ bill, rawBill }) => mapBillToRow(bill, rawBill)),
      (row) => row.id,
    );
    const billRows = uniqueByKey(
      [
        ...syncedBillRows,
        ...buildFederalVotePlaceholderBillRows(syncedBillRows, voteRows),
      ],
      (row) => row.id,
    );
    const actionRows = uniqueByKey(finalizedBills.flatMap(({ bill }) =>
      bill.actions.map((action, index) => mapBillActionToRow(bill.id, action, index)),
    ), (row) => `${row.bill_id}:${row.sort_order}`);
    const versionRows = uniqueByKey(finalizedBills.flatMap(({ bill }) =>
      bill.versions.map((version, index) => mapBillVersionToRow(bill.id, version, index)),
    ), (row) => `${row.bill_id}:${row.version_id}`);
    const committeeRows = uniqueByKey(
      committeesWithMembers.map(({ committee, rawCommittee }) => mapCommitteeToRow(committee, rawCommittee)),
      (row) => row.id,
    );

    try {
      await upsertStoredBills(billRows);
    } catch (error) {
      throw new Error(`Bills write failed: ${getErrorMessage(error)}`);
    }

    try {
      const billIds = finalizedBills.map(({ bill }) => bill.id);
      const existingActionRows = await listStoredBillActionRowsByBillIds(billIds);
      const existingActionSignatureByBillId = new Map<string, Set<string>>();
      const nextActionSortOrderByBillId = new Map<string, number>();

      existingActionRows.forEach((row) => {
        const signature = `${row.date}|${row.label}|${row.detail}|${row.type}`;
        const signatures = existingActionSignatureByBillId.get(row.bill_id) || new Set<string>();
        signatures.add(signature);
        existingActionSignatureByBillId.set(row.bill_id, signatures);
        nextActionSortOrderByBillId.set(
          row.bill_id,
          Math.max(nextActionSortOrderByBillId.get(row.bill_id) || 0, row.sort_order + 1),
        );
      });

      const appendedActionRows = finalizedBills.flatMap(({ bill }) =>
        bill.actions.flatMap((action) => {
          const signature = `${action.date}|${action.label}|${action.detail}|${action.type}`;
          const existingSignatures = existingActionSignatureByBillId.get(bill.id) || new Set<string>();
          if (existingSignatures.has(signature)) {
            return [];
          }

          const nextSortOrder = nextActionSortOrderByBillId.get(bill.id) || 0;
          nextActionSortOrderByBillId.set(bill.id, nextSortOrder + 1);
          existingSignatures.add(signature);
          existingActionSignatureByBillId.set(bill.id, existingSignatures);

          return [mapBillActionToRow(bill.id, action, nextSortOrder)];
        }),
      );

      await appendStoredBillActions(appendedActionRows);
    } catch (error) {
      throw new Error(`Bill actions write failed: ${getErrorMessage(error)}`);
    }

    try {
      const billIds = finalizedBills.map(({ bill }) => bill.id);
      const existingVersionRows = await listStoredBillVersionRowsByBillIds(billIds);
      const existingVersionIdsByBillId = new Map<string, Set<string>>();

      existingVersionRows.forEach((row) => {
        const ids = existingVersionIdsByBillId.get(row.bill_id) || new Set<string>();
        ids.add(row.version_id);
        existingVersionIdsByBillId.set(row.bill_id, ids);
      });

      const appendedVersionRows = versionRows.filter((row) => {
        const ids = existingVersionIdsByBillId.get(row.bill_id) || new Set<string>();
        if (ids.has(row.version_id)) {
          return false;
        }

        ids.add(row.version_id);
        existingVersionIdsByBillId.set(row.bill_id, ids);
        return true;
      });

      await appendStoredBillVersions(appendedVersionRows);
    } catch (error) {
      throw new Error(`Bill versions write failed: ${getErrorMessage(error)}`);
    }

    if (syncCommittees) {
      try {
        await upsertStoredCommittees(committeeRows);
      } catch (error) {
        throw new Error(`Committees write failed: ${getErrorMessage(error)}`);
      }

      try {
        await replaceStoredCommitteeMemberships(
          committeeRows.map((row) => row.id),
          committeeMembershipRows,
        );
      } catch (error) {
        throw new Error(`Committee membership write failed: ${getErrorMessage(error)}`);
      }
    }

    if (updatedPoliticianRows.length > 0 || placeholderPoliticianRows.length > 0) {
      try {
        const { upsertStoredPoliticians } = await import("@/lib/supabase/politicians");
        await upsertStoredPoliticians([...updatedPoliticianRows, ...placeholderPoliticianRows]);
      } catch (error) {
        throw new Error(`Federal politician stats write failed: ${getErrorMessage(error)}`);
      }
    }

    if (!voteSyncWarning && voteRows.length > 0) {
      try {
        await appendStoredVotes(
          voteRows,
          positionRows,
        );
      } catch (error) {
        voteSyncWarning = `Federal votes write failed: ${getErrorMessage(error)}`;
      }
    }

    const staleBillsDeleted = shouldPruneStaleBills
      ? buildStaleCongressBillIds(
        existingStored.billRows,
        new Set(syncedBillRows.map((row) => row.id)),
        new Set([...existingStored.voteBillIds, ...voteRows.map((row) => row.bill_id)]),
        congressSession,
      )
      : [];
    if (staleBillsDeleted.length > 0) {
      await deleteBillArtifacts(staleBillsDeleted);
    }

    return {
      billsSynced: billRows.length,
      detailedBillsSynced,
      committeesSynced: committeeRows.length,
      votesSynced: voteRows.length,
      committeesEnabled: syncCommittees,
      votesEnabled: syncVotes,
      requestedOffset: options?.listOffset ?? 0,
      requestedLimit: options?.listLimit ?? null,
      preservedBills,
      detailFailures,
      staleBillsDeleted: staleBillsDeleted.length,
      voteSyncWarning,
      at: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(getErrorMessage(error));
  }
}
