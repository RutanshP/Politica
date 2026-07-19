export const FUNDING_GRAPH_ENTITY_TYPES = [
  "politician",
  "individualDonor",
  "donorAggregate",
  "candidateCommittee",
  "pac",
  "partyCommittee",
  "independentExpenditureGroup",
  "employer",
  "industry",
  "company",
  "union",
  "advocacyGroup",
  "lobbyingFirm",
  "committee",
  "bill",
  "amendment",
  "vote",
  "issue",
  "agency",
] as const;

export type FundingGraphEntityType = (typeof FUNDING_GRAPH_ENTITY_TYPES)[number];

export const FUNDING_GRAPH_RELATIONSHIP_TYPES = [
  "contributed_to",
  "transferred_to",
  "supports",
  "opposes",
  "independent_spending_support",
  "independent_spending_oppose",
  "employee_contributions",
  "industry_contributions",
  "employed_by",
  "affiliated_with",
  "retained",
  "lobbied_on",
  "member_of",
  "chairs",
  "sponsored",
  "cosponsored",
  "voted_on",
  "considered",
  "classified_under",
  "affected_by",
] as const;

export type FundingGraphRelationshipType = (typeof FUNDING_GRAPH_RELATIONSHIP_TYPES)[number];

/** Money flows in from the left; legislative activity sits on the right. */
export const MONEY_ENTITY_TYPES: readonly FundingGraphEntityType[] = [
  "individualDonor",
  "donorAggregate",
  "pac",
  "partyCommittee",
  "independentExpenditureGroup",
  "employer",
  "industry",
  "company",
  "union",
  "advocacyGroup",
  "lobbyingFirm",
];

export const LEGISLATIVE_ENTITY_TYPES: readonly FundingGraphEntityType[] = [
  "committee",
  "bill",
  "amendment",
  "vote",
  "issue",
  "agency",
];

export const FINANCIAL_RELATIONSHIP_TYPES: readonly FundingGraphRelationshipType[] = [
  "contributed_to",
  "transferred_to",
  "independent_spending_support",
  "independent_spending_oppose",
  "employee_contributions",
  "industry_contributions",
  "retained",
];

export interface FundingGraphNodeData {
  label: string;
  subtitle?: string;
  entityType: FundingGraphEntityType;
  imageUrl?: string;
  amount?: number;
  transactionCount?: number;
  electionCycle?: number;
  isAggregate?: boolean;
  sourceCount?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface FundingGraphNode {
  id: string;
  data: FundingGraphNodeData;
}

export interface FundingGraphEdgeData {
  relationshipType: FundingGraphRelationshipType;
  label: string;
  amount?: number;
  transactionCount?: number;
  electionCycle?: number;
  occurredAt?: string;
  isAggregate: boolean;
  sourceCount: number;
  sourceUrl?: string;
}

export interface FundingGraphEdge {
  id: string;
  source: string;
  target: string;
  data: FundingGraphEdgeData;
}

export interface PoliticianGraphSummary {
  id: string;
  slug: string;
  name: string;
  office: string;
  party: string;
  state: string;
  district?: string;
  imageUrl?: string;
}

export interface FundingGraphTotals {
  totalReceipts: number;
  individualContributions: number;
  pacContributions: number;
  smallDollarContributions: number;
  smallDollarPercentage: number;
  selfFunding: number;
  independentSupport: number;
  independentOpposition: number;
}

export interface FundingGraphResponse {
  politician: PoliticianGraphSummary;
  centerNodeId: string;
  nodes: FundingGraphNode[];
  edges: FundingGraphEdge[];
  totals: FundingGraphTotals;
  availableFilters: {
    cycles: number[];
    nodeTypes: string[];
    edgeTypes: string[];
    industries: string[];
  };
  /** True when any node or edge came from the illustrative demo fixture. */
  containsDemoData: boolean;
  truncated: boolean;
  nextExpansionToken?: string;
  generatedAt: string;
}

export interface FundingGraphFilters {
  cycle?: number;
  depth: number;
  minimumAmount?: number;
  maximumAmount?: number;
  nodeTypes?: FundingGraphEntityType[];
  edgeTypes?: FundingGraphRelationshipType[];
  groupSmallDonors: boolean;
  showLegislative: boolean;
  showLobbying: boolean;
  showIndependentExpenditures: boolean;
  limit: number;
}

export const DEFAULT_FUNDING_GRAPH_FILTERS: FundingGraphFilters = {
  depth: 2,
  groupSmallDonors: true,
  showLegislative: true,
  showLobbying: true,
  showIndependentExpenditures: true,
  limit: 30,
};

/** Hard ceilings from the product spec. */
export const FUNDING_GRAPH_INITIAL_NODE_LIMIT = 30;
export const FUNDING_GRAPH_EXPANDED_NODE_LIMIT = 100;
export const FUNDING_GRAPH_MAX_NODE_LIMIT = 150;

export interface FundingSourceRecord {
  id: string;
  edge_id: string;
  record_type: string;
  amount: number | null;
  occurred_on: string | null;
  contributor_name: string | null;
  contributor_employer: string | null;
  contributor_occupation: string | null;
  recipient: string | null;
  description: string | null;
  source_url: string | null;
  source_system: string;
}

export interface GraphEntityRow {
  id: string;
  slug: string;
  entity_type: string;
  label: string;
  subtitle: string | null;
  image_url: string | null;
  metadata: Record<string, unknown>;
  source_system: string;
  source_id: string;
  source_url: string | null;
  synced_at: string;
}

export interface GraphEdgeRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  relationship_direction: string;
  amount: number | null;
  transaction_count: number | null;
  election_cycle: number | null;
  occurred_at: string | null;
  start_date: string | null;
  end_date: string | null;
  is_aggregate: boolean;
  confidence: number | null;
  metadata: Record<string, unknown>;
  source_system: string;
  source_id: string;
  source_url: string | null;
  synced_at: string;
}
