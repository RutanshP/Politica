export type EntityType =
  | "bill"
  | "politician"
  | "committee"
  | "donor"
  | "pac"
  | "company"
  | "industry"
  | "lobbying-firm"
  | "issue"
  | "vote"
  | "agency"
  | "state";

export type DataAvailability =
  | "live"
  | "partial"
  | "empty"
  | "unconfigured"
  | "unavailable";

export interface DataFreshness {
  pipeline: string;
  syncedAt?: string;
  stale: boolean;
  detail?: string;
}

export interface SourceMetadata {
  sourceSystem: string;
  sourceId: string;
  syncedAt?: string;
  rawAvailable?: boolean;
}

export type BillStatus =
  | "Introduced"
  | "In Committee"
  | "On Floor"
  | "Passed Chamber"
  | "Sent to President"
  | "Signed"
  | "Failed";

export interface BillAction {
  date: string;
  label: string;
  detail: string;
  type: "milestone" | "committee" | "floor" | "executive";
}

export interface BillVersion {
  id: string;
  label: string;
  date: string;
  type: string;
  content: string[];
  sourceUrl?: string;
  formats?: Array<{
    type: string;
    url: string;
  }>;
  isFullTextAvailable?: boolean;
}

export interface Bill {
  id: string;
  slug?: string;
  number: string;
  title: string;
  summary: string;
  jurisdiction: "Federal" | "State";
  country: string;
  state?: string;
  jurisdictionType?: "federal" | "state";
  sessionId?: string;
  chamber: string;
  status: BillStatus;
  topic: string;
  sponsorId: string;
  sponsorName: string;
  committeeId: string;
  committeeName: string;
  latestAction: string;
  lastActionAt: string;
  introducedAt: string;
  session: string;
  chanceOfPassing: number;
  stats: {
    amendments: number;
    cosponsors: number;
    votes: number;
    bipartisanScore: number;
  };
  actions: BillAction[];
  versions: BillVersion[];
  relatedBillIds: string[];
  sourceMetadata?: SourceMetadata;
}

export interface Politician {
  id: string;
  slug: string;
  name: string;
  title: string;
  party: string;
  state: string;
  district?: string;
  biography: string;
  born: string;
  education: string;
  occupation: string;
  website: string;
  officePhone: string;
  officeAddress: string;
  nextElection: string;
  jurisdictionType?: "federal" | "state";
  sessionId?: string;
  stats: {
    votesWithParty: number;
    votesAgainstParty: number;
    attendance: number;
    billsIntroduced: number;
    billsPassed: number;
    amendmentsOffered: number;
  };
  ideology: Record<string, number>;
  sourceMetadata?: SourceMetadata;
}

export interface VotePosition {
  politicianId: string;
  name: string;
  party: string;
  state: string;
  vote: "Yea" | "Nay" | "Present" | "Not Voting";
  sourceMetadata?: SourceMetadata;
}

export interface Vote {
  id: string;
  canonicalId?: string;
  billId: string;
  billNumber: string;
  title: string;
  chamber: string;
  dateLabel: string;
  result: string;
  yea: number;
  nay: number;
  present: number;
  notVoting: number;
  positions: VotePosition[];
  sourceMetadata?: SourceMetadata;
}

export interface Committee {
  id: string;
  slug: string;
  name: string;
  chamber: string;
  jurisdiction: string;
  chair: string;
  rankingMember: string;
  description: string;
  hearing: string;
  activeBillIds: string[];
  memberIds: string[];
  contactUrl?: string;
  contactPhone?: string;
  contactAddress?: string;
  subcommittees?: Array<{
    name: string;
    systemCode?: string;
  }>;
  jurisdictionType?: "federal" | "state";
  sessionId?: string;
  sourceMetadata?: SourceMetadata;
}

export interface CommitteeMembership {
  committeeId: string;
  politicianId: string;
  role: string;
  sortOrder: number;
  sourceMetadata?: SourceMetadata;
}

export interface NewsItem {
  id: string;
  canonicalId?: string;
  headline: string;
  source: string;
  publishedAt: string;
  relatedIds: string[];
  summary: string;
  url?: string;
  sourceMetadata?: SourceMetadata;
}

export interface Issue {
  id: string;
  slug: string;
  name: string;
  description: string;
  stats: {
    activeBills: number;
    recentVotes: number;
    bipartisanSupport: number;
  };
  topBillIds: string[];
  committeeIds: string[];
  sourceMetadata?: SourceMetadata;
}

export interface WatchlistItem {
  id: string;
  label: string;
  type: EntityType;
  lastUpdated: string;
  status: string;
  href: string;
}

export interface FundingNode {
  id: string;
  label: string;
  type: EntityType;
  detail: string;
  amount?: string;
  href?: string;
  sourceMetadata?: SourceMetadata;
}

export interface FundingEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  amount: number;
  sourceMetadata?: SourceMetadata;
}

export interface SearchEntity {
  id: string;
  type: EntityType | "news";
  label: string;
  title: string;
  description: string;
  href: string;
  meta: string;
  sourceMetadata?: SourceMetadata;
}

export interface SyncPipelineSummary {
  pipeline: string;
  status: "success" | "partial" | "failed" | "running";
  startedAt?: string;
  finishedAt?: string;
  recordCount: number;
  error?: string;
}
