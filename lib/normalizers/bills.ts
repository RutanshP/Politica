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

function sponsorNameFromListBill(bill: CongressBillListItem) {
  const sponsor = bill.sponsors?.[0];
  return sponsor?.fullName || [sponsor?.firstName, sponsor?.lastName].filter(Boolean).join(" ") || "Congress Sponsor";
}

function normalizeStatus(actionText?: string) {
  const text = (actionText || "").toLowerCase();

  if (text.includes("became public law") || text.includes("signed")) return "Signed";
  if (text.includes("presented to president") || text.includes("sent to president")) {
    return "Sent to President";
  }
  if (text.includes("passed house") || text.includes("passed senate")) return "Passed Chamber";
  if (text.includes("placed on calendar") || text.includes("considered")) return "On Floor";
  if (text.includes("committee") || text.includes("subcommittee")) return "In Committee";
  if (text.includes("failed")) return "Failed";

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

export function normalizeCongressBillListItem(bill: CongressBillListItem): Bill {
  const billType = String(bill.type || "").toLowerCase();
  const billNumber = String(bill.number || "");
  const sponsorName = sponsorNameFromListBill(bill);

  return {
    id: buildBillId(billType, billNumber),
    slug: buildBillId(billType, billNumber),
    number: `${String(bill.type || "").toUpperCase()}.${billNumber}`,
    title: titleFromListBill(bill),
    summary: "Live Congress.gov bill imported. Rich summaries can be layered in from stored detail records or generated briefs later.",
    jurisdiction: "Federal",
    country: "United States",
    chamber: bill.originChamber || "Congress",
    status: normalizeStatus(bill.latestAction?.text),
    topic: topicFromPolicyArea(bill.policyArea),
    sponsorId: bill.sponsors?.[0]?.bioguideId || buildBillId("sponsor", sponsorName),
    sponsorName,
    committeeId: "federal-committee-pending",
    committeeName: "Committee data pending full detail sync",
    latestAction: bill.latestAction?.text || "Latest action unavailable",
    lastActionAt: formatDisplayDate(bill.latestAction?.actionDate || bill.updateDate),
    introducedAt: formatDisplayDate(undefined),
    session: `${bill.congress || "Unknown"}th Congress`,
    chanceOfPassing: 50,
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

  const titles = detail.titles ?? [];
  const officialTitle = titles.find((title) => title.titleType?.toLowerCase().includes("official"))?.title
    || titles[0]?.title
    || seed.title;

  const actions = (actionsPayload?.actions ?? []).slice(0, 8).map((action) => ({
    date: formatDisplayDate(action.actionDate),
    label: action.type || "Action",
    detail: action.text || "No action detail available",
    type: actionTypeFromText(action.text),
  }));

  const versions: BillVersion[] = (textPayload?.textVersions ?? []).slice(0, 4).map((version, index) => ({
    id: `${seed.id}-text-${index + 1}`,
    label: version.type || `Text version ${index + 1}`,
    date: formatDisplayDate(version.date),
    type: version.type || "Version",
    content: [
      "Live text metadata imported from Congress.gov.",
      ...(version.formats?.map((format) => `${format.type || "Format"}: ${format.url || "Unavailable"}`) ?? []),
    ],
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
    chanceOfPassing: deriveChanceOfPassing(detail, actions.length),
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
