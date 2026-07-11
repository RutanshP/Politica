import { normalizePersonLookup } from "@/lib/utils";
import type { Vote } from "@/types/civic";

const HOUSE_VOTE_BASE = process.env.POLITICA_HOUSE_VOTE_BASE_URL?.trim()
  || "https://clerk.house.gov/evs";
const SENATE_VOTE_BASE = process.env.POLITICA_SENATE_VOTE_BASE_URL?.trim()
  || "https://www.senate.gov/legislative/LIS/roll_call_votes";
const FEDERAL_VOTE_FETCH_TIMEOUT_MS = Number.parseInt(
  process.env.POLITICA_FEDERAL_VOTE_FETCH_TIMEOUT_MS?.trim() || "15000",
  10,
);

const HOUSE_NOT_FOUND_STATUSES = new Set([403, 404]);
const SENATE_NOT_FOUND_STATUSES = new Set([403, 404]);

type VoteCast = Vote["positions"][number]["vote"];

export interface FederalVotePositionRecord {
  politicianId: string | null;
  externalId: string | null;
  name: string;
  party: string;
  state: string;
  vote: VoteCast;
}

export interface FederalVoteRecord {
  id: string;
  canonicalId: string;
  billId: string | null;
  billNumber: string;
  title: string;
  chamber: string;
  dateLabel: string;
  result: string;
  yea: number;
  nay: number;
  present: number;
  notVoting: number;
  positions: FederalVotePositionRecord[];
  sourceSystem: "house_clerk" | "senate_lis";
  sourceId: string;
  rawPayload: string;
}

function decodeXmlText(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function getTagValue(xml: string, tagName: string) {
  const match = xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i"));
  return match ? decodeXmlText(match[1]).trim() : "";
}

function getAllBlocks(xml: string, tagName: string) {
  return [...xml.matchAll(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "gi"))]
    .map((match) => match[1]);
}

function parseAttributes(source: string) {
  return Object.fromEntries(
    [...source.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], decodeXmlText(match[2])]),
  );
}

function normalizeVoteCast(value?: string | null): VoteCast {
  const normalized = (value || "").trim().toLowerCase();

  if (normalized === "yea" || normalized === "aye" || normalized === "yes") {
    return "Yea";
  }
  if (normalized === "nay" || normalized === "no") {
    return "Nay";
  }
  if (normalized.includes("present")) {
    return "Present";
  }

  return "Not Voting";
}

function toNumber(value?: string | null) {
  const parsed = Number.parseInt((value || "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

const FEDERAL_BILL_PREFIXES: Record<string, string> = {
  hr: "hr",
  hres: "hres",
  hjres: "hjres",
  hconres: "hconres",
  s: "s",
  sres: "sres",
  sjres: "sjres",
  sconres: "sconres",
};

export function normalizeFederalBillId(value?: string | null) {
  const compact = (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = compact.match(/^(hconres|hjres|hres|hr|sconres|sjres|sres|s)(\d+)$/);
  if (!match) {
    return null;
  }

  const prefix = FEDERAL_BILL_PREFIXES[match[1]];
  return prefix ? `${prefix}-${match[2]}` : null;
}

export function normalizeFederalVoteMatchKey(input: {
  name?: string | null;
  state?: string | null;
  party?: string | null;
}) {
  return `${normalizePersonLookup(input.name)}|${(input.state || "").trim().toUpperCase()}|${(input.party || "").trim().toUpperCase()}`;
}

export function parseHouseRollCallVoteXml(xml: string) {
  const metadataMatch = xml.match(/<vote-metadata>([\s\S]*?)<\/vote-metadata>/i);
  if (!metadataMatch) {
    throw new Error("House vote metadata not found");
  }

  const metadata = metadataMatch[1];
  const congress = getTagValue(metadata, "congress");
  const session = getTagValue(metadata, "session").replace(/[^\d]/g, "") || "1";
  const rollcallNum = getTagValue(metadata, "rollcall-num");
  const billNumber = getTagValue(metadata, "legis-num") || "House Vote";
  const billId = normalizeFederalBillId(billNumber);

  const positions = [...xml.matchAll(/<recorded-vote>\s*<legislator([^>]*)>([\s\S]*?)<\/legislator>\s*<vote>([\s\S]*?)<\/vote>\s*<\/recorded-vote>/gi)]
    .map((match) => {
      const attributes = parseAttributes(match[1]);
      return {
        politicianId: attributes["name-id"] || null,
        externalId: attributes["name-id"] || null,
        name: decodeXmlText(match[2]).trim(),
        party: attributes.party || "",
        state: attributes.state || "",
        vote: normalizeVoteCast(match[3]),
      };
    });

  return {
    id: `house-${congress}-${session}-${rollcallNum.padStart(4, "0")}`,
    canonicalId: `house-roll-${congress}-${session}-${rollcallNum}`,
    billId,
    billNumber,
    title: getTagValue(metadata, "vote-question") || billNumber || "House Vote",
    chamber: "House",
    dateLabel: getTagValue(metadata, "action-date"),
    result: getTagValue(metadata, "vote-result") || "Unknown",
    yea: toNumber(getTagValue(metadata, "yea-total")),
    nay: toNumber(getTagValue(metadata, "nay-total")),
    present: toNumber(getTagValue(metadata, "present-total")),
    notVoting: toNumber(getTagValue(metadata, "not-voting-total")),
    positions,
    sourceSystem: "house_clerk" as const,
    sourceId: `roll-${rollcallNum}`,
    rawPayload: xml,
  } satisfies FederalVoteRecord;
}

export function parseSenateRollCallVoteXml(xml: string) {
  const congress = getTagValue(xml, "congress");
  const session = getTagValue(xml, "session") || "1";
  const voteNumber = getTagValue(xml, "vote_number");
  const documentType = getTagValue(xml, "document_type");
  const documentNumber = getTagValue(xml, "document_number");
  const billNumber = [documentType, documentNumber].filter(Boolean).join(" ").trim() || "Senate Vote";
  const billId = normalizeFederalBillId(billNumber);

  const positions = getAllBlocks(xml, "member").map((block) => ({
    politicianId: null,
    externalId: getTagValue(block, "lis_member_id") || null,
    name: [getTagValue(block, "first_name"), getTagValue(block, "last_name")].filter(Boolean).join(" ").trim()
      || getTagValue(block, "member_full"),
    party: getTagValue(block, "party"),
    state: getTagValue(block, "state"),
    vote: normalizeVoteCast(getTagValue(block, "vote_cast")),
  }));

  return {
    id: `senate-${congress}-${session}-${voteNumber.padStart(5, "0")}`,
    canonicalId: `senate-roll-${congress}-${session}-${voteNumber}`,
    billId,
    billNumber,
    title: getTagValue(xml, "vote_title") || getTagValue(xml, "vote_question_text") || billNumber || "Senate Vote",
    chamber: "Senate",
    dateLabel: getTagValue(xml, "vote_date"),
    result: getTagValue(xml, "vote_result") || getTagValue(xml, "vote_result_text") || "Unknown",
    yea: toNumber(getTagValue(xml, "yeas")),
    nay: toNumber(getTagValue(xml, "nays")),
    present: toNumber(getTagValue(xml, "present")),
    notVoting: toNumber(getTagValue(xml, "absent")),
    positions,
    sourceSystem: "senate_lis" as const,
    sourceId: `vote-${voteNumber}`,
    rawPayload: xml,
  } satisfies FederalVoteRecord;
}

async function fetchTextOrNull(
  url: string,
  notFoundStatuses: Set<number>,
) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(
      Number.isFinite(FEDERAL_VOTE_FETCH_TIMEOUT_MS) && FEDERAL_VOTE_FETCH_TIMEOUT_MS > 0
        ? FEDERAL_VOTE_FETCH_TIMEOUT_MS
        : 15000,
    ),
    headers: {
      Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (notFoundStatuses.has(response.status)) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Federal vote request failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

export async function fetchHouseRollCallVote(year: number, rollCallNumber: number) {
  const url = `${HOUSE_VOTE_BASE}/${year}/roll${String(rollCallNumber).padStart(3, "0")}.xml`;
  const xml = await fetchTextOrNull(url, HOUSE_NOT_FOUND_STATUSES);
  return xml ? parseHouseRollCallVoteXml(xml) : null;
}

export async function fetchSenateRollCallVote(
  congress: string,
  session: 1 | 2,
  voteNumber: number,
) {
  const url = `${SENATE_VOTE_BASE}/vote${congress}${session}/vote_${congress}_${session}_${String(voteNumber).padStart(5, "0")}.xml`;
  const xml = await fetchTextOrNull(url, SENATE_NOT_FOUND_STATUSES);
  return xml ? parseSenateRollCallVoteXml(xml) : null;
}
