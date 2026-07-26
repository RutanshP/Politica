import type { Bill, BillAction, BillVersion } from "@/types/civic";
import type {
  CongressBillActionPayload,
  CongressBillDetailPayload,
  CongressBillListItem,
  CongressBillTextPayload,
} from "@/types/congress";

function formatDisplayDate(value?: string) {
  if (!value) return "Unknown";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function buildBillId(type?: string, number?: string | number) {
  return `${String(type || "").toLowerCase()}-${String(number || "").toLowerCase()}`;
}

function titleFromListBill(bill: CongressBillListItem) {
  return bill.title?.trim() || `${String(bill.type || "").toUpperCase()} ${bill.number}`;
}

function isGenericCongressTitle(value?: string) {
  const normalized = (value || "").trim();
  return /^([A-Z]+\.?\s*)\d+$/i.test(normalized);
}

function rankCongressTitleType(value?: string) {
  const normalized = (value || "").toLowerCase();
  if (normalized.includes("short")) return 0;
  if (normalized.includes("popular")) return 1;
  if (normalized.includes("official")) return 2;
  return 3;
}

function extractTitleFromSummary(summary?: string) {
  const strongMatch = summary?.match(/<strong>(.*?)<\/strong>/i);
  if (strongMatch?.[1]?.trim()) {
    return strongMatch[1].trim();
  }

  return undefined;
}

export function chooseCongressBillTitle(
  titles: Array<{ title?: string; titleType?: string }>,
  fallbackTitle: string,
  summaryText?: string,
) {
  const rankedTitles = titles
    .map((entry) => ({
      title: entry.title?.trim(),
      rank: rankCongressTitleType(entry.titleType),
    }))
    .filter((entry): entry is { title: string; rank: number } => Boolean(entry.title))
    .sort((left, right) => left.rank - right.rank);

  const preferredNonGenericTitle = rankedTitles.find((entry) => !isGenericCongressTitle(entry.title))?.title;
  if (preferredNonGenericTitle) {
    return preferredNonGenericTitle;
  }

  const summaryTitle = extractTitleFromSummary(summaryText);
  if (summaryTitle) {
    return summaryTitle;
  }

  const fallback = fallbackTitle.trim();
  if (!isGenericCongressTitle(fallback)) {
    return fallback;
  }

  return rankedTitles[0]?.title || fallback;
}

function sponsorNameFromListBill(bill: CongressBillListItem) {
  const sponsor = bill.sponsors?.[0];
  return sponsor?.fullName || [sponsor?.firstName, sponsor?.lastName].filter(Boolean).join(" ") || "Congress Sponsor";
}

// A "failed" motion to recommit or table means the bill SURVIVED that procedural attack, not
// that the bill itself failed -- only count it as terminal when it isn't one of those.
function isTerminalFailure(text: string) {
  if (!text.includes("failed")) return false;
  return !text.includes("recommit") && !text.includes("to table");
}

function normalizeStatus(actionText?: string) {
  const text = (actionText || "").toLowerCase();

  if (text.includes("became public law") || text.includes("signed")) return "Signed";
  if (text.includes("presented to president") || text.includes("sent to president")) {
    return "Sent to President";
  }
  if (text.includes("passed house") || text.includes("passed senate")) return "Passed Chamber";
  if (isTerminalFailure(text)) return "Failed";
  if (text.includes("placed on calendar") || text.includes("considered")) return "On Floor";
  if (text.includes("committee") || text.includes("subcommittee")) return "In Committee";

  return "Introduced";
}

function topicFromPolicyArea(policyArea?: { name?: string }) {
  return policyArea?.name || "General";
}

function actionTypeFromText(text?: string): BillAction["type"] {
  const lower = (text || "").toLowerCase();
  if (lower.includes("committee")) return "committee";
  if (lower.includes("president") || lower.includes("signed")) return "executive";
  if (lower.includes("passed") || lower.includes("agreed to")) return "floor";
  return "milestone";
}

function asArray<T>(value: T[] | T | null | undefined) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value == null) {
    return [] as T[];
  }

  return [value];
}

export function normalizeCongressBillListItem(bill: CongressBillListItem): Bill {
  const billType = String(bill.type || "").toLowerCase();
  const billNumber = String(bill.number || "");
  const sponsorName = sponsorNameFromListBill(bill);
  const status = normalizeStatus(bill.latestAction?.text);

  return {
    id: buildBillId(billType, billNumber),
    slug: buildBillId(billType, billNumber),
    number: `${String(bill.type || "").toUpperCase()}.${billNumber}`,
    title: titleFromListBill(bill),
    summary: "Official summary not provided by the source yet. Stored bill details will appear here as more metadata is synced.",
    jurisdiction: "Federal",
    country: "United States",
    chamber: bill.originChamber || "Congress",
    status,
    topic: topicFromPolicyArea(bill.policyArea),
    sponsorId: bill.sponsors?.[0]?.bioguideId || buildBillId("sponsor", sponsorName),
    sponsorName,
    committeeId: "federal-committee-pending",
    committeeName: "Committee data pending full detail sync",
    latestAction: bill.latestAction?.text || "Latest action unavailable",
    lastActionAt: formatDisplayDate(bill.latestAction?.actionDate || bill.updateDate),
    introducedAt: formatDisplayDate(undefined),
    session: `${bill.congress || "Unknown"}th Congress`,
    chanceOfPassing: chanceOfPassingForStatus(status, 50),
    stats: {
      amendments: 0,
      cosponsors: Math.max((bill.sponsors?.length || 1) - 1, 0),
      votes: 0,
      bipartisanScore: 0,
    },
    actions: bill.latestAction?.text
      ? [
          {
            date: formatDisplayDate(bill.latestAction.actionDate || bill.updateDate),
            label: "Latest action",
            detail: bill.latestAction.text,
            type: actionTypeFromText(bill.latestAction.text),
          },
        ]
      : [],
    versions: [],
    relatedBillIds: [],
    jurisdictionType: "federal",
    sourceMetadata: {
      sourceSystem: "congress",
      sourceId: buildBillId(billType, billNumber),
      rawAvailable: true,
    },
  };
}

export function mergeCongressBillDetail(
  seed: Bill,
  detailPayload: CongressBillDetailPayload,
  actionsPayload?: CongressBillActionPayload,
  textPayload?: CongressBillTextPayload,
) {
  const detail = detailPayload.bill;
  if (!detail) return seed;

  const titles = asArray(detail.titles);
  const officialTitle = chooseCongressBillTitle(titles, seed.title);

  const actions = [...(actionsPayload?.actions ?? [])]
    .sort((left, right) => {
      const leftTime = left.actionDate ? Date.parse(left.actionDate) : 0;
      const rightTime = right.actionDate ? Date.parse(right.actionDate) : 0;
      return leftTime - rightTime;
    })
    .map((action) => ({
      date: formatDisplayDate(action.actionDate),
      label: action.type || "Action",
      detail: action.text || "No action detail available",
      type: actionTypeFromText(action.text),
    }));

  const versions: BillVersion[] = (textPayload?.textVersions ?? []).map((version, index) => ({
    id: `${seed.id}-text-${index + 1}`,
    label: version.type || `Text version ${index + 1}`,
    date: formatDisplayDate(version.date),
    type: version.type || "Version",
    content: [
      "Stored bill text metadata imported from Congress.gov.",
      ...(version.formats?.map((format) => `${format.type || "Format"}: ${format.url || "Unavailable"}`) ?? []),
    ],
    sourceUrl: version.formats?.[0]?.url,
    formats: (version.formats ?? [])
      .filter((format): format is { type: string; url: string } => Boolean(format?.type && format?.url))
      .map((format) => ({
        type: format.type,
        url: format.url,
      })),
    isFullTextAvailable: false,
  }));

  return {
    ...seed,
    title: officialTitle,
    summary:
      detail.constitutionalAuthorityStatementText?.trim()
      || seed.summary,
    introducedAt: formatDisplayDate(detail.introducedDate),
    latestAction: detail.latestAction?.text || seed.latestAction,
    lastActionAt: formatDisplayDate(detail.latestAction?.actionDate || detail.updateDate),
    sponsorId: detail.sponsors?.[0]?.bioguideId || seed.sponsorId,
    sponsorName:
      detail.sponsors?.[0]?.fullName
      || [detail.sponsors?.[0]?.firstName, detail.sponsors?.[0]?.lastName].filter(Boolean).join(" ")
      || seed.sponsorName,
    topic: topicFromPolicyArea(detail.policyArea) || seed.topic,
    chanceOfPassing: chanceOfPassingForStatus(seed.status, deriveChanceOfPassing(detail, actions.length)),
    stats: {
      amendments: 0,
      cosponsors: Math.max((detail.sponsors?.length || 1) - 1, 0),
      votes: actions.filter((action) => action.type === "floor").length,
      bipartisanScore: deriveBipartisanScore(detail, actions.length),
    },
    actions: actions.length > 0 ? actions : seed.actions,
    versions: versions.length > 0 ? versions : seed.versions,
    relatedBillIds: seed.relatedBillIds,
    sourceMetadata: {
      sourceSystem: "congress",
      sourceId: detail.number ? buildBillId(detail.type, detail.number) : seed.id,
      rawAvailable: true,
    },
  };
}

function chanceOfPassingForStatus(status: Bill["status"], computed: number) {
  if (status === "Failed") return 0;
  if (status === "Signed") return 100;
  return computed;
}

function deriveChanceOfPassing(detail: NonNullable<CongressBillDetailPayload["bill"]>, actionCount: number) {
  const sponsorCount = detail.sponsors?.length || 1;
  const committeeSignal = detail.committees?.count || 0;
  return Math.min(85, 30 + sponsorCount * 4 + committeeSignal * 3 + actionCount * 3);
}

function deriveBipartisanScore(detail: NonNullable<CongressBillDetailPayload["bill"]>, actionCount: number) {
  const sponsorCount = detail.sponsors?.length || 1;
  return Math.min(100, 20 + sponsorCount * 5 + actionCount * 4);
}

export function parseBillId(billId: string) {
  const match = billId.match(/^([a-z]+)-(\d+)$/i);
  if (!match) return null;

  return {
    billType: match[1].toLowerCase(),
    billNumber: match[2],
  };
}
