import type { Bill, BillAction, CommitteeMembership, Issue, Politician, Vote } from "@/types/civic";

export interface JurisdictionRow {
  id: string;
  slug: string;
  name: string;
  jurisdiction_type: "federal" | "state";
  country: string;
  state_code: string | null;
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
}

export interface LegislativeSessionRow {
  id: string;
  slug: string;
  jurisdiction_id: string;
  name: string;
  session_code: string;
  start_date: string | null;
  end_date: string | null;
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
}

export interface PoliticianRow {
  id: string;
  slug: string;
  name: string;
  title: string;
  party: string;
  state: string;
  district: string | null;
  biography: string;
  born: string;
  education: string;
  occupation: string;
  website: string;
  office_phone: string;
  office_address: string;
  next_election: string;
  stats: Politician["stats"];
  ideology: Politician["ideology"];
  source: string;
  source_system?: string;
  source_id?: string;
  jurisdiction_type?: "federal" | "state";
  state_code?: string | null;
  session_id?: string | null;
  source_updated_at?: string | null;
  source_fingerprint?: string | null;
  last_profile_synced_at?: string | null;
  last_stats_recomputed_at?: string | null;
  is_current?: boolean;
  synced_at: string;
  raw_payload?: unknown;
  raw_member: unknown;
  /**
   * Terms of office from unitedstates/congress-legislators (migration 021). Authoritative over
   * the per-Congress rows in raw_member, which never state when a term ends. Sitting members
   * only -- that dataset covers current legislators.
   */
  official_terms?: unknown;
}

export interface BillRow {
  id: string;
  slug?: string | null;
  number: string;
  title: string;
  summary: string;
  jurisdiction: Bill["jurisdiction"];
  country: string;
  state: string | null;
  chamber: string;
  status: Bill["status"];
  topic: string;
  sponsor_id: string;
  sponsor_name: string;
  committee_id: string;
  committee_name: string;
  latest_action: string;
  last_action_at: string;
  introduced_at: string;
  session: string;
  chance_of_passing: number;
  stats: Bill["stats"];
  related_bill_ids: string[];
  source: string;
  source_system?: string;
  source_id?: string;
  jurisdiction_type?: "federal" | "state";
  state_code?: string | null;
  session_id?: string | null;
  source_updated_at?: string | null;
  source_fingerprint?: string | null;
  last_detail_synced_at?: string | null;
  last_actions_synced_at?: string | null;
  last_versions_synced_at?: string | null;
  last_votes_synced_at?: string | null;
  synced_at: string;
  raw_payload?: unknown;
  raw_bill: unknown;
}

export interface BillActionRow {
  bill_id: string;
  sort_order: number;
  date: string;
  label: string;
  detail: string;
  type: BillAction["type"];
}

export interface BillVersionRow {
  bill_id: string;
  version_id: string;
  sort_order: number;
  label: string;
  date: string;
  type: string;
  content: string[];
  source_url?: string | null;
  formats?: Array<{
    type: string;
    url: string;
  }>;
  is_full_text_available?: boolean;
}

export interface CommitteeRow {
  id: string;
  slug: string;
  name: string;
  chamber: string;
  jurisdiction: string;
  chair: string;
  ranking_member: string;
  description: string;
  hearing: string;
  active_bill_ids: string[];
  member_ids: string[];
  contact_url?: string | null;
  contact_phone?: string | null;
  contact_address?: string | null;
  subcommittees?: Array<{
    name: string;
    systemCode?: string;
  }>;
  source: string;
  source_system?: string;
  source_id?: string;
  jurisdiction_type?: "federal" | "state";
  state_code?: string | null;
  session_id?: string | null;
  synced_at: string;
  raw_payload?: unknown;
  raw_committee: unknown;
}

export interface CommitteeMemberRow {
  committee_id: string;
  politician_id: string;
  role: CommitteeMembership["role"];
  sort_order: number;
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
}

export interface VoteRow {
  id: string;
  bill_id: string | null;
  canonical_id: string | null;
  bill_number: string;
  /** The measure's name once a bill is linked, otherwise the motion. Use `question` for the motion. */
  title: string;
  /** The motion: "On Agreeing to the Amendment", "On Passage", "On Motion to Recommit". */
  question?: string | null;
  /** What the amendment does, or the Clerk's <vote-desc> where no amendment link was resolved. */
  description?: string | null;
  /** "H.Amdt. 266", for a roll call on an amendment. */
  amendment_number?: string | null;
  amendment_sponsor?: string | null;
  /** congress.gov page for the amendment, which is where its text reads. */
  amendment_url?: string | null;
  chamber: string;
  /** Display text only ("September 9, 2025,  12:48 PM" / "Sep 9, 2025"). Never sort by this. */
  date_label: string;
  /** Orders roll calls within a single day, which date_label cannot. */
  action_time?: string | null;
  /** The parsed vote timestamp. This is what orders a vote list chronologically. */
  voted_on?: string | null;
  result: string;
  yea: number;
  nay: number;
  present: number;
  not_voting: number;
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
  /** "federal" | "state". Without it, a state roll call is indistinguishable from a federal one. */
  jurisdiction_type?: string | null;
  /** Two-letter code for state roll calls; null for federal. */
  state_code?: string | null;
}

export interface VotePositionRow {
  vote_id: string;
  politician_id: string;
  name: string;
  party: string;
  state: string;
  vote: Vote["positions"][number]["vote"];
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
}

export interface IssueRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  stats: Issue["stats"];
  top_bill_ids: string[];
  committee_ids: string[];
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
}

export interface IssueBillLinkRow {
  issue_id: string;
  bill_id: string;
  sort_order: number;
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
}

export interface NewsItemRow {
  id: string;
  canonical_id: string | null;
  headline: string;
  source: string;
  published_at: string;
  related_ids: string[];
  summary: string;
  url: string | null;
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
}

export interface NewsEntityLinkRow {
  news_item_id: string;
  entity_id: string;
  entity_type: string;
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
}

export interface FinanceEntityRow {
  id: string;
  slug: string;
  label: string;
  entity_type: string;
  detail: string;
  amount: string | null;
  href: string | null;
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
}

export interface FinanceEdgeRow {
  id: string;
  source: string;
  target: string;
  label: string;
  amount: number;
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
}

export interface CandidateFinanceSnapshotRow {
  id: string;
  politician_id: string;
  election_cycle: string;
  receipts: number;
  disbursements: number;
  cash_on_hand: number;
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
}

export interface ElectionCandidateRow {
  id: string;
  fec_candidate_id: string;
  cycle: number;
  election_year: number | null;
  office: string;
  office_full: string | null;
  party: string | null;
  party_full: string | null;
  state: string | null;
  district: string | null;
  incumbent_challenge: string | null;
  incumbent_challenge_full: string | null;
  candidate_status: string | null;
  candidate_inactive: boolean | null;
  active_through: number | null;
  name: string;
  politician_id: string | null;
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
}

export interface SearchDocumentRow {
  id: string;
  entity_id: string;
  entity_type: string;
  label: string;
  title: string;
  description: string;
  href: string;
  meta: string;
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
}

export interface AnalyticsSnapshotRow {
  id: string;
  key: string;
  payload: unknown;
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
}

export interface EntityRow {
  id: string;
  entity_type: string;
  label: string;
  title: string;
  description: string;
  href: string;
  meta: string;
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
}

export interface EntityRelationshipRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  weight: number;
  source_system: string;
  source_id: string;
  synced_at: string;
  raw_payload: unknown;
}

export interface SyncRunRow {
  id: string;
  pipeline: string;
  status: "success" | "partial" | "failed" | "running";
  record_count: number;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
  metadata: unknown;
}

export interface SyncErrorRow {
  id: string;
  pipeline: string;
  stage: string;
  message: string;
  payload: unknown;
  created_at: string;
}
