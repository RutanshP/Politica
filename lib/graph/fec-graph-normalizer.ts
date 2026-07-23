import { slugifySegment } from "@/lib/utils";
import type {
  FecCandidateTotalsRow,
  FecCommitteeRow,
  FecEmployerAggregateRow,
  FecScheduleEByCandidateRow,
  FecSizeAggregateRow,
} from "@/lib/adapters/fec";
import type { GraphEdgeRow, GraphEntityRow } from "@/types/funding-graph";
import type { CandidateFinanceSnapshotRow } from "@/types/supabase";

export interface FecSyncPolitician {
  id: string;
  slug: string;
  name: string;
  title: string;
  party: string;
  state: string;
  district?: string | null;
}

export interface FecPoliticianPayloads {
  cycle: number;
  totals: FecCandidateTotalsRow[];
  committees: FecCommitteeRow[];
  byEmployer: FecEmployerAggregateRow[];
  bySize: FecSizeAggregateRow[];
  scheduleE: FecScheduleEByCandidateRow[];
}

/**
 * Picks the FEC candidate id matching the member's current office: House ids
 * start with H, Senate with S. Falls back to the last id (newest) when no
 * prefix matches.
 */
export function pickFecCandidateId(fecIds: string[], title: string) {
  const wantPrefix = /senator/i.test(title) ? "S" : /representative/i.test(title) ? "H" : undefined;
  if (wantPrefix) {
    const matching = fecIds.filter((id) => id.toUpperCase().startsWith(wantPrefix));
    if (matching.length > 0) return matching[matching.length - 1];
  }
  return fecIds[fecIds.length - 1];
}

/**
 * Employer strings that are not real employers -- either non-employment
 * statuses or self-employment, which would otherwise dominate every
 * by-employer breakdown without naming an organization.
 */
const NON_EMPLOYER_VALUES = new Set([
  "",
  "RETIRED",
  "NOT EMPLOYED",
  "NOT-EMPLOYED",
  "UNEMPLOYED",
  "SELF",
  "SELF-EMPLOYED",
  "SELF EMPLOYED",
  "NONE",
  "N/A",
  "NA",
  "INFORMATION REQUESTED",
  "HOMEMAKER",
]);

export function isRealEmployer(employer: string | null | undefined) {
  return Boolean(employer && !NON_EMPLOYER_VALUES.has(employer.trim().toUpperCase()));
}

function round(value: number | undefined | null) {
  return Math.round(value || 0);
}

const SMALL_DOLLAR_SIZE_BUCKET = 0; // by_size bucket 0 = contributions under $200

export interface FecGraphRows {
  entities: GraphEntityRow[];
  edges: GraphEdgeRow[];
  snapshot: CandidateFinanceSnapshotRow;
  totals: {
    cycle: number;
    totalReceipts: number;
    individualContributions: number;
    pacContributions: number;
    smallDollarContributions: number;
    smallDollarPercentage: number;
    selfFunding: number;
    independentSupport: number;
    independentOpposition: number;
  };
}

/**
 * Maps one politician's fetched FEC payloads to funding-graph rows. Pure and
 * deterministic apart from `syncedAt`. Every aggregate is labeled as such;
 * employee-contribution groupings are never presented as corporate gifts.
 */
export function buildFecGraphRows(
  politician: FecSyncPolitician,
  candidateId: string,
  payloads: FecPoliticianPayloads,
  syncedAt = new Date().toISOString(),
): FecGraphRows {
  const { cycle } = payloads;
  const totalsRow = payloads.totals[0] || {};

  const individual = round(
    totalsRow.individual_contributions
    ?? (round(totalsRow.individual_itemized_contributions) + round(totalsRow.individual_unitemized_contributions)),
  );
  const pac = round(totalsRow.other_political_committee_contributions)
    + round(totalsRow.political_party_committee_contributions);
  const selfFunding = round(totalsRow.candidate_contribution);
  const smallDollarBucket = payloads.bySize.find((row) => row.size === SMALL_DOLLAR_SIZE_BUCKET);
  const smallDollar = round(smallDollarBucket?.total ?? totalsRow.individual_unitemized_contributions);
  const ieSupport = round(
    payloads.scheduleE
      .filter((row) => row.support_oppose_indicator === "S")
      .reduce((sum, row) => sum + (row.total || 0), 0),
  );
  const ieOppose = round(
    payloads.scheduleE
      .filter((row) => row.support_oppose_indicator === "O")
      .reduce((sum, row) => sum + (row.total || 0), 0),
  );

  const totals = {
    cycle,
    totalReceipts: round(totalsRow.receipts),
    individualContributions: individual,
    pacContributions: pac,
    smallDollarContributions: smallDollar,
    smallDollarPercentage: individual > 0 ? Math.round((smallDollar / individual) * 1000) / 10 : 0,
    selfFunding,
    independentSupport: ieSupport,
    independentOpposition: ieOppose,
  };

  const politicianEntityId = `pol-${politician.id}`;
  const entities: GraphEntityRow[] = [];
  const edges: GraphEdgeRow[] = [];

  entities.push({
    id: politicianEntityId,
    slug: politician.slug,
    entity_type: "politician",
    label: politician.name,
    subtitle: [politician.title, politician.district || politician.state].filter(Boolean).join(" - "),
    image_url: null,
    metadata: {
      politicianId: politician.id,
      party: politician.party,
      state: politician.state,
      district: politician.district || null,
      fecCandidateId: candidateId,
      totals,
    },
    source_system: "fec_sync",
    source_id: candidateId,
    source_url: `https://www.fec.gov/data/candidate/${candidateId}/`,
    synced_at: syncedAt,
  });

  // Principal campaign committee (designation P), falling back to authorized.
  const principal = payloads.committees.find((row) => row.designation === "P")
    || payloads.committees.find((row) => row.designation === "A")
    || payloads.committees[0];
  const committeeEntityId = principal?.committee_id ? `fec-cmte-${principal.committee_id}` : undefined;

  if (principal?.committee_id && committeeEntityId) {
    entities.push({
      id: committeeEntityId,
      slug: committeeEntityId,
      entity_type: "candidateCommittee",
      label: principal.name || "Principal campaign committee",
      subtitle: principal.designation_full || "Campaign committee",
      image_url: null,
      metadata: {
        committeeType: principal.designation_full || principal.committee_type_full || null,
        fecCommitteeId: principal.committee_id,
      },
      source_system: "fec_sync",
      source_id: principal.committee_id,
      source_url: `https://www.fec.gov/data/committee/${principal.committee_id}/`,
      synced_at: syncedAt,
    });
    edges.push({
      id: `fec-affil-${principal.committee_id}-${politician.id}`,
      source_entity_id: committeeEntityId,
      target_entity_id: politicianEntityId,
      relationship_type: "affiliated_with",
      relationship_direction: "directed",
      amount: null,
      transaction_count: null,
      election_cycle: null,
      occurred_at: null,
      start_date: null,
      end_date: null,
      is_aggregate: false,
      confidence: 1,
      metadata: { role: "Principal campaign committee" },
      source_system: "fec_sync",
      source_id: principal.committee_id,
      source_url: `https://www.fec.gov/data/committee/${principal.committee_id}/`,
      synced_at: syncedAt,
    });
  }

  const moneyTargetId = committeeEntityId || politicianEntityId;
  const filingsUrl = `https://www.fec.gov/data/candidate/${candidateId}/?cycle=${cycle}`;

  // Named employers of itemized individual contributors, merged across the spelling variants FEC
  // reports ("GOOGLE", "Google", "Google Inc") that normalize to one slug -- otherwise two rows
  // sharing a slug emit duplicate edge ids and the upsert batch fails (Postgres 21000). Computed
  // here because the individual-donor hub is sized as the remainder once these are broken out.
  const employerAggregates = new Map<string, { label: string; total: number; count: number }>();
  for (const row of payloads.byEmployer) {
    if (!isRealEmployer(row.employer) || (row.total || 0) <= 0) continue;
    const label = row.employer!.trim();
    const slug = slugifySegment(label).slice(0, 60) || "employer";
    const existing = employerAggregates.get(slug);
    if (existing) {
      existing.total += round(row.total);
      existing.count += row.count ?? 0;
    } else {
      employerAggregates.set(slug, { label, total: round(row.total), count: row.count ?? 0 });
    }
  }
  const topEmployers = [...employerAggregates.entries()]
    .sort((left, right) => right[1].total - left[1].total)
    .slice(0, 8);
  const namedEmployerTotal = topEmployers.reduce((sum, [, aggregate]) => sum + aggregate.total, 0);

  // Money reaches the committee in tiers, not a star. The named employers contribute *directly* --
  // these are itemized individual contributions to the campaign, not routed through any middleman.
  // What is left of individual giving once those are broken out is the "Other individual donors"
  // hub, of which small-dollar is a labeled subset; PACs contribute to the committee directly. When
  // there is no remainder, the breakdowns fall back to the committee so nothing is orphaned.
  const hubAmount = Math.max(0, round(individual - namedEmployerTotal));
  const individualEntityId = hubAmount > 0 ? `fec-ind-${politician.id}` : undefined;
  const donorRollupTarget = individualEntityId || moneyTargetId;

  const aggregateEdge = (
    idSuffix: string,
    sourceEntityId: string,
    relationshipType: string,
    amount: number,
    transactionCount: number | null,
    metadata: Record<string, unknown> = {},
    targetEntityId: string = moneyTargetId,
  ): GraphEdgeRow => ({
    id: `fec-${idSuffix}`,
    source_entity_id: sourceEntityId,
    target_entity_id: targetEntityId,
    relationship_type: relationshipType,
    relationship_direction: "directed",
    amount,
    transaction_count: transactionCount,
    election_cycle: cycle,
    occurred_at: syncedAt,
    start_date: null,
    end_date: null,
    is_aggregate: true,
    confidence: 1,
    metadata,
    source_system: "fec_sync",
    source_id: `fec-${idSuffix}`,
    source_url: filingsUrl,
    synced_at: syncedAt,
  });

  if (individualEntityId) {
    const hasNamedEmployers = namedEmployerTotal > 0;
    entities.push({
      id: individualEntityId,
      slug: individualEntityId,
      entity_type: "donorAggregate",
      label: hasNamedEmployers ? "Other individual donors" : "Individual donors",
      subtitle: hasNamedEmployers
        ? "Individual contributions outside the named employers"
        : "All individual contributions",
      image_url: null,
      metadata: {
        aggregationType: hasNamedEmployers
          ? "individual contributions not attributed to a named top employer"
          : "all individual contributions",
        methodology: hasNamedEmployers
          ? "Individual contributions remaining after the named top employers are broken out and connected to the committee directly."
          : "Sum of itemized and unitemized individual contributions reported by the campaign committee for this cycle.",
      },
      source_system: "fec_sync",
      source_id: individualEntityId,
      source_url: filingsUrl,
      synced_at: syncedAt,
    });
    edges.push(aggregateEdge(`ind-${politician.id}-${cycle}`, individualEntityId, "contributed_to", hubAmount, null));
  }

  if (smallDollar > 0) {
    const entityId = `fec-small-${politician.id}`;
    entities.push({
      id: entityId,
      slug: entityId,
      entity_type: "donorAggregate",
      label: "Small-dollar donors",
      subtitle: "Contributions under $200",
      image_url: null,
      metadata: {
        aggregationType: "unitemized under-$200 contributions",
        methodology:
          "Contributions under $200 are reported only as totals; individual small donors are not identified in source filings.",
      },
      source_system: "fec_sync",
      source_id: entityId,
      source_url: filingsUrl,
      synced_at: syncedAt,
    });
    edges.push(aggregateEdge(
      `small-${politician.id}-${cycle}`,
      entityId,
      "contributed_to",
      smallDollar,
      smallDollarBucket?.count ?? null,
      { subsetOf: `fec-ind-${politician.id}-${cycle}` },
      donorRollupTarget,
    ));
  }

  if (pac > 0) {
    const entityId = `fec-pacagg-${politician.id}`;
    entities.push({
      id: entityId,
      slug: entityId,
      entity_type: "pac",
      label: "PACs & party committees",
      subtitle: "Aggregated committee contributions",
      image_url: null,
      metadata: {
        aggregationType: "all PAC and party-committee contributions",
        methodology:
          "Sum of contributions from other political committees and party committees reported for this cycle. Itemized per-PAC breakdowns are a planned enhancement.",
      },
      source_system: "fec_sync",
      source_id: entityId,
      source_url: filingsUrl,
      synced_at: syncedAt,
    });
    edges.push(aggregateEdge(`pacagg-${politician.id}-${cycle}`, entityId, "contributed_to", pac, null));
  }

  // Named employers (computed above) contribute directly to the committee, labeled as employee
  // aggregates -- never corporate treasury gifts.
  for (const [employerSlug, aggregate] of topEmployers) {
    const entityId = `fec-emp-${employerSlug}`;
    entities.push({
      id: entityId,
      slug: entityId,
      entity_type: "employer",
      // Named for the organization itself. FEC groups these itemized contributions by the
      // employer each donor reported; the subtitle keeps that provenance honest while the label
      // reads as the company, which is how the money is understood in practice.
      label: aggregate.label,
      subtitle: "Employee-reported contributions",
      image_url: null,
      metadata: {
        aggregationType: "contributions grouped by contributor-reported employer",
        methodology:
          "Itemized individual contributions grouped by the employer field each contributor reported. This is not a contribution by the organization itself.",
        employer: aggregate.label,
      },
      source_system: "fec_sync",
      source_id: entityId,
      source_url: filingsUrl,
      synced_at: syncedAt,
    });
    edges.push(aggregateEdge(
      `emp-${employerSlug}-${politician.id}-${cycle}`,
      entityId,
      "employee_contributions",
      aggregate.total,
      aggregate.count || null,
      {},
      moneyTargetId,
    ));
  }

  // Independent expenditures target the politician directly -- by law they are
  // uncoordinated with the campaign committee.
  const ieEdge = (
    indicator: "S" | "O",
    amount: number,
    count: number,
  ) => {
    const supporting = indicator === "S";
    const entityId = `fec-ie-${supporting ? "sup" : "opp"}-${politician.id}`;
    entities.push({
      id: entityId,
      slug: entityId,
      entity_type: "independentExpenditureGroup",
      label: supporting ? "Outside groups - supporting" : "Outside groups - opposing",
      subtitle: "Independent expenditures",
      image_url: null,
      metadata: {
        aggregationType: "independent expenditures by outside groups",
        note: "Independent expenditures are made without coordination with the candidate.",
      },
      source_system: "fec_sync",
      source_id: entityId,
      source_url: filingsUrl,
      synced_at: syncedAt,
    });
    edges.push({
      ...aggregateEdge(
        `ie-${supporting ? "sup" : "opp"}-${politician.id}-${cycle}`,
        entityId,
        supporting ? "independent_spending_support" : "independent_spending_oppose",
        amount,
        count,
      ),
      target_entity_id: politicianEntityId,
    });
  };
  const ieSupportCount = payloads.scheduleE
    .filter((row) => row.support_oppose_indicator === "S")
    .reduce((sum, row) => sum + (row.count || 0), 0);
  const ieOpposeCount = payloads.scheduleE
    .filter((row) => row.support_oppose_indicator === "O")
    .reduce((sum, row) => sum + (row.count || 0), 0);
  if (ieSupport > 0) ieEdge("S", ieSupport, ieSupportCount);
  if (ieOppose > 0) ieEdge("O", ieOppose, ieOpposeCount);

  const snapshot: CandidateFinanceSnapshotRow = {
    id: `${politician.id}-${cycle}`,
    politician_id: politician.id,
    election_cycle: String(cycle),
    receipts: totals.totalReceipts,
    disbursements: round(totalsRow.disbursements),
    cash_on_hand: round(totalsRow.cash_on_hand_end_period),
    source_system: "fec_sync",
    source_id: candidateId,
    synced_at: syncedAt,
    raw_payload: totalsRow,
  };

  return { entities, edges, snapshot, totals };
}
