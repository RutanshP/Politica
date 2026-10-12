import { organizationKey } from "@/lib/organization-names";
import type {
  FundingGraphEdge,
  FundingGraphNode,
  FundingGraphResponse,
} from "@/types/funding-graph";

/*
 * Turns the generic funding graph into the three bands the member money-flow diagram draws:
 * where the money came from, the member it reached, and the bills they sponsored that someone
 * lobbied on.
 *
 * Everything here is pure, so the layout and the editorial rules are testable without a database.
 * The rule that matters most: the right-hand band is lobbying, never contributions. An
 * organization appearing on both sides is two separate filings saying two separate things, and
 * the copy has to keep them separate.
 */

/** Money sources, in the order the diagram stacks them: broadest base first, narrowest last. */
export const SOURCE_KIND_ORDER = [
  "individuals",
  "employer",
  "pac",
  "party",
  "outside",
  "self",
] as const;

export type MoneyFlowSourceKind = (typeof SOURCE_KIND_ORDER)[number];

export const SOURCE_KIND_LABEL: Record<MoneyFlowSourceKind, string> = {
  individuals: "Individual donors",
  employer: "Employees of",
  pac: "PAC",
  party: "Party committee",
  outside: "Outside spending",
  self: "The candidate",
};

export interface MoneyFlowSource {
  id: string;
  label: string;
  kind: MoneyFlowSourceKind;
  amount: number;
  /** True when the row is a roll-up of many contributors rather than one filer's own gift. */
  isAggregate: boolean;
  /** Against the member rather than for them. Only ever set on `outside`. */
  isOpposition: boolean;
  /** How the number was arrived at, where the source entity carried one. */
  methodology?: string;
  sourceUrl?: string;
  /** Matches a lobbying client name, so the two bands can be tied together. */
  orgKey: string;
}

export interface MoneyFlowBill {
  billId: string;
  number: string;
  title: string;
  status: string;
  href: string;
  /** Organizations that named this bill in an LDA filing. */
  clients: number;
  reports: number;
}

/** One organization that both gave money and lobbied on a bill the member sponsored. */
export interface MoneyFlowBothSides {
  orgKey: string;
  name: string;
  amount: number;
  kind: MoneyFlowSourceKind;
  bills: { billId: string; number: string; href: string }[];
}

const MONEY_IN = new Set(["contributed_to", "transferred_to", "employee_contributions", "industry_contributions"]);

/**
 * Which band a money edge belongs to. Reads the edge first and the source entity second: an
 * independent expenditure is defined by being independent, whoever made it.
 */
export function classifySource(
  edge: FundingGraphEdge,
  sourceType: string | undefined,
): { kind: MoneyFlowSourceKind; isOpposition: boolean } | null {
  const relationship = edge.data.relationshipType;
  if (relationship === "independent_spending_support") return { kind: "outside", isOpposition: false };
  if (relationship === "independent_spending_oppose") return { kind: "outside", isOpposition: true };
  if (!MONEY_IN.has(relationship)) return null;

  if (relationship === "employee_contributions" || relationship === "industry_contributions") {
    return { kind: "employer", isOpposition: false };
  }
  if (sourceType === "employer" || sourceType === "industry" || sourceType === "company") {
    return { kind: "employer", isOpposition: false };
  }
  if (sourceType === "pac" || sourceType === "lobbyingFirm" || sourceType === "union" || sourceType === "advocacyGroup") {
    return { kind: "pac", isOpposition: false };
  }
  if (sourceType === "partyCommittee") return { kind: "party", isOpposition: false };
  if (sourceType === "politician") return { kind: "self", isOpposition: false };
  if (sourceType === "individualDonor" || sourceType === "donorAggregate") {
    return { kind: "individuals", isOpposition: false };
  }
  return null;
}

/**
 * Collapses the graph's money edges into one row per source. A source that reaches the member
 * through several edges (different cycles, several of their committees) is summed, because the
 * diagram answers "how much came from here", not "how many filings said so".
 */
export function collectSources(graph: Pick<FundingGraphResponse, "nodes" | "edges">): MoneyFlowSource[] {
  const nodesById = new Map<string, FundingGraphNode>(graph.nodes.map((node) => [node.id, node]));
  const byId = new Map<string, MoneyFlowSource>();

  for (const edge of graph.edges) {
    const amount = edge.data.amount ?? 0;
    if (amount <= 0) continue;
    const source = nodesById.get(edge.source);
    if (!source) continue;

    const classified = classifySource(edge, source.data.entityType);
    if (!classified) continue;

    // Opposition money is the same organization doing the opposite thing, so it is its own row.
    const rowId = classified.isOpposition ? `${edge.source}::oppose` : edge.source;
    const existing = byId.get(rowId);
    if (existing) {
      existing.amount += amount;
      continue;
    }

    const metadata = source.data.metadata ?? {};
    byId.set(rowId, {
      id: rowId,
      label: source.data.label,
      kind: classified.kind,
      amount,
      isAggregate: Boolean(source.data.isAggregate ?? edge.data.isAggregate),
      isOpposition: classified.isOpposition,
      methodology: typeof metadata.methodology === "string" ? metadata.methodology : undefined,
      sourceUrl: edge.data.sourceUrl,
      orgKey: organizationKey(source.data.label),
    });
  }

  return [...byId.values()].sort((a, b) => b.amount - a.amount);
}

/**
 * The rows the diagram can actually draw, plus one honest remainder. A diagram that silently
 * shows the top eight of ninety reads as the whole picture, so whatever is cut comes back as a
 * single labelled band rather than disappearing.
 */
export function topSourcesWithRemainder(
  sources: MoneyFlowSource[],
  limit: number,
): { shown: MoneyFlowSource[]; remainder: { amount: number; count: number } } {
  if (sources.length <= limit) return { shown: sources, remainder: { amount: 0, count: 0 } };
  const shown = sources.slice(0, limit);
  const rest = sources.slice(limit);
  return {
    shown,
    remainder: {
      amount: rest.reduce((sum, source) => sum + source.amount, 0),
      count: rest.length,
    },
  };
}

/**
 * Organizations that appear in both bands. Matched on `organizationKey`, which already survives
 * the punctuation differences between an FEC employer string and an LDA client name.
 *
 * Deliberately excludes opposition spending: "spent against them and lobbied their bill" is a
 * different claim from "funded them and lobbied their bill", and conflating the two would be
 * wrong.
 */
export function findBothSides(
  sources: MoneyFlowSource[],
  billClients: { billId: string; number: string; href: string; clientKeys: string[] }[],
): MoneyFlowBothSides[] {
  const byOrg = new Map<string, MoneyFlowSource>();
  for (const source of sources) {
    if (source.isOpposition || !source.orgKey) continue;
    const existing = byOrg.get(source.orgKey);
    if (!existing || source.amount > existing.amount) byOrg.set(source.orgKey, source);
  }

  const hits = new Map<string, MoneyFlowBothSides>();
  for (const bill of billClients) {
    for (const clientKey of new Set(bill.clientKeys)) {
      const source = byOrg.get(clientKey);
      if (!source) continue;
      const existing = hits.get(clientKey);
      if (existing) {
        if (!existing.bills.some((entry) => entry.billId === bill.billId)) {
          existing.bills.push({ billId: bill.billId, number: bill.number, href: bill.href });
        }
        continue;
      }
      hits.set(clientKey, {
        orgKey: clientKey,
        name: source.label,
        amount: source.amount,
        kind: source.kind,
        bills: [{ billId: bill.billId, number: bill.number, href: bill.href }],
      });
    }
  }

  return [...hits.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

/**
 * Vertical positions for one band of the diagram, in a fixed-height SVG. Each row gets height in
 * proportion to its amount, with a floor so a small donor is still a clickable target, and a
 * constant gap so neighbouring ribbons never touch.
 */
export function stackBand(
  amounts: number[],
  options: { height: number; gap: number; minHeight: number },
): { y: number; height: number }[] {
  const { height, gap, minHeight } = options;
  if (amounts.length === 0) return [];

  const gaps = gap * Math.max(0, amounts.length - 1);
  const usable = Math.max(0, height - gaps);
  const total = amounts.reduce((sum, amount) => sum + Math.max(0, amount), 0);

  // Give every row its floor first, then share what is left by amount. With no money anywhere
  // (an uncontested member, say) the rows divide the space evenly instead of collapsing to zero.
  const floors = amounts.map(() => Math.min(minHeight, usable / amounts.length));
  const floorTotal = floors.reduce((sum, value) => sum + value, 0);
  const flexible = Math.max(0, usable - floorTotal);

  let y = 0;
  return amounts.map((amount, index) => {
    const share = total > 0 ? Math.max(0, amount) / total : 1 / amounts.length;
    const rowHeight = floors[index] + flexible * share;
    const box = { y, height: rowHeight };
    y += rowHeight + gap;
    return box;
  });
}
