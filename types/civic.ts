export type EntityType =
  | "bill"
  | "politician"
  | "committee"
  | "pac"
  | "company"
  | "industry"
  | "lobbying-firm"
  | "issue";

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
}

export interface Bill {
  id: string;
  number: string;
  title: string;
  summary: string;
  jurisdiction: "Federal" | "State";
  country: string;
  state?: string;
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
  stats: {
    votesWithParty: number;
    votesAgainstParty: number;
    attendance: number;
    billsIntroduced: number;
    billsPassed: number;
    amendmentsOffered: number;
  };
  ideology: Record<string, number>;
}

export interface VotePosition {
  politicianId: string;
  name: string;
  party: string;
  state: string;
  vote: "Yea" | "Nay" | "Present" | "Not Voting";
}

export interface Vote {
  id: string;
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
}

export interface NewsItem {
  id: string;
  headline: string;
  source: string;
  publishedAt: string;
  relatedIds: string[];
  summary: string;
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
}

export interface FundingEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  amount: number;
}
