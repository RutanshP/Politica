import type { Bill, BillAction, BillStatus, BillVersion } from "@/types/civic";
import type {
  CongressBillActionPayload,
  CongressBillDetailPayload,
  CongressBillListItem,
  CongressBillTextPayload,
} from "@/types/congress";

/*
 * Formatted in UTC, deliberately.
 *
 * Congress.gov sends action dates as bare "2026-07-22", which `new Date` parses as UTC midnight.
 * Formatting that without a timeZone uses the runtime's zone, so the same action renders "Jul 22,
 * 2026" on Vercel (UTC) and "Jul 21, 2026" on a US-local machine -- and timestamped values go the
 * other way, rendering a day later in UTC+ zones.
 *
 * That is not just a cosmetic drift. Stored actions are appended, not replaced, and the dedupe
 * signature is `date|label|detail|type` -- so the moment the rendered date moves, every action on
 * the bill fails its signature check and gets appended a second time. It produced 4,199 duplicate
 * rows across 1,190 bills, 4,088 of them exactly one day apart, including impossible pairs like
 * "Introduced in Senate" on two dates. Pinning the zone makes the string a stable function of the
 * source value, which is what the signature assumes.
 */
function formatDisplayDate(value?: string) {
  if (!value) return "Unknown";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
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

/**
 * Whether the text records the bill itself being defeated.
 *
 * A "failed" motion to recommit or to table means the bill SURVIVED that procedural attack, so a
 * bare "failed" cannot be the signal. Matching it and then excluding the motions it appears
 * inside was too blunt in both directions: "Motion to table the motion to reconsider the vote by
 * which S.J. Res. 49 failed of passage ... agreed to" contains "to table" and was dismissed,
 * even though it records a defeat being made final. Match the defeat phrasings outright instead.
 */
function isTerminalFailure(text: string) {
  if (/veto sustained/.test(text)) return true;
  // "Failed of passage", "failed passage of House", "failed to pass".
  if (/failed (?:of )?passage|failed to pass/.test(text)) return true;
  // "On motion to suspend the rules and pass the bill Failed by the Yeas and Nays (2/3 required)"
  // -- a defeat on passage that never uses the word "passage". Anchoring on what failed keeps a
  // failed motion to recommit or to table, where the bill survived, from matching.
  return /pass the (?:bill|resolution|joint resolution|measure)[^.]*failed/.test(text);
}

/** How far along each status sits. Mirrors STATUS_ORDER in components/bill-progress.tsx. */
const STATUS_RANK: Record<BillStatus, number> = {
  Failed: -1,
  Introduced: 0,
  "In Committee": 1,
  "On Floor": 2,
  "Passed Chamber": 3,
  "Sent to President": 4,
  Signed: 5,
};

/**
 * The milestone a single action attests to, or undefined when it attests to none.
 *
 * The chamber-passage phrasing matters: Congress.gov writes "Passed/agreed to in House", not
 * "Passed House". Matching the latter caught 57 of the 945 stored House-passage actions, which
 * is why almost no bill ever reached "Passed Chamber".
 */
function milestoneFromActionText(actionText: string): BillStatus | undefined {
  const text = actionText.toLowerCase();

  if (text.includes("became public law") || text.includes("signed by president")) return "Signed";
  if (text.includes("presented to president") || text.includes("sent to president")) {
    return "Sent to President";
  }
  if (
    /passed\/agreed to in (?:the )?(?:house|senate)/.test(text)
    || text.includes("passed house")
    || text.includes("passed senate")
  ) {
    return "Passed Chamber";
  }
  if (
    text.includes("calendar")
    || text.includes("considered")
    || text.includes("cloture")
    || text.includes("motion to proceed")
    || text.includes("debate")
  ) {
    return "On Floor";
  }
  if (text.includes("committee") || text.includes("subcommittee")) return "In Committee";

  return undefined;
}

/**
 * The furthest milestone the bill has actually reached, across its whole history.
 *
 * Reading only the newest action made status non-monotonic: a bill that passed the House and was
 * then filibustered in the Senate reported "Introduced", because the cloture action matches no
 * milestone and fell through to the default. Progress is cumulative, so the status has to be a
 * maximum over the history rather than a snapshot of its last line.
 *
 * A terminal failure is the exception -- it describes the bill's present fate, not a rung it
 * climbed -- so it wins when it is the most recent thing that happened.
 */
export function deriveBillStatus(actionTexts: string[], latestActionText?: string): BillStatus {
  if (latestActionText && isTerminalFailure(latestActionText.toLowerCase())) {
    return "Failed";
  }

  let furthest: BillStatus = "Introduced";
  for (const text of [...actionTexts, ...(latestActionText ? [latestActionText] : [])]) {
    const milestone = milestoneFromActionText(text);
    if (milestone && STATUS_RANK[milestone] > STATUS_RANK[furthest]) {
      furthest = milestone;
    }
  }

  return furthest;
}

/** Single-action derivation, for list rows that carry only a latest action. */
function normalizeStatus(actionText?: string) {
  return deriveBillStatus([], actionText);
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

  // The seed's status came from the list row's single latest action. Now that the full history is
  // in hand, recompute it -- this is the only place that can see the whole climb.
  const latestActionText = detail.latestAction?.text || seed.latestAction;
  const status = deriveBillStatus(
    actions.map((action) => action.detail),
    latestActionText,
  );

  return {
    ...seed,
    title: officialTitle,
    status,
    summary:
      detail.constitutionalAuthorityStatementText?.trim()
      || seed.summary,
    introducedAt: formatDisplayDate(detail.introducedDate),
    latestAction: latestActionText,
    lastActionAt: formatDisplayDate(detail.latestAction?.actionDate || detail.updateDate),
    sponsorId: detail.sponsors?.[0]?.bioguideId || seed.sponsorId,
    sponsorName:
      detail.sponsors?.[0]?.fullName
      || [detail.sponsors?.[0]?.firstName, detail.sponsors?.[0]?.lastName].filter(Boolean).join(" ")
      || seed.sponsorName,
    topic: topicFromPolicyArea(detail.policyArea) || seed.topic,
    chanceOfPassing: chanceOfPassingForStatus(status, deriveChanceOfPassing(detail, actions.length)),
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
