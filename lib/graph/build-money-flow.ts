import "server-only";

import { buildPoliticianFundingGraph } from "@/lib/graph/build-politician-funding-graph";
import {
  collectSources,
  findBothSides,
  topSourcesWithRemainder,
  type MoneyFlowBill,
  type MoneyFlowBothSides,
  type MoneyFlowSource,
} from "@/lib/graph/money-flow-model";
import { getBillLobbying, getMostLobbiedBills } from "@/lib/data/lobbying";
import { organizationKey } from "@/lib/organization-names";
import { billHref } from "@/lib/utils";
import type { FundingGraphFilters, FundingGraphTotals, PoliticianGraphSummary } from "@/types/funding-graph";

/** How many rows each band can carry before the rest is rolled into one labelled remainder. */
export const MONEY_FLOW_SOURCE_LIMIT = 9;
const BILL_LIMIT = 6;
/** Enough of each bill's client list to catch the member's own donors without pulling thousands. */
const CLIENTS_PER_BILL = 150;

export interface MoneyFlow {
  politician: PoliticianGraphSummary;
  totals: FundingGraphTotals;
  cycleLabel: string;
  sources: MoneyFlowSource[];
  remainder: { amount: number; count: number };
  bills: MoneyFlowBill[];
  bothSides: MoneyFlowBothSides[];
  /** Bills exist but their lobbying client lists could not be read; the band says so rather than showing nothing. */
  lobbyingUnavailable: boolean;
}

/**
 * Composes the member money-flow view: money in on the left from the FEC graph, bills the member
 * sponsored on the right from the LDA filings, and the organizations that turn up in both.
 *
 * The two sides come from different filings and mean different things -- one is a contribution
 * report, the other is a lobbying disclosure -- so they are fetched and counted separately and
 * only joined by organization name at the very end.
 */
export async function buildMoneyFlow(
  slug: string,
  filters: FundingGraphFilters,
  options: { includeLobbying?: boolean } = {},
): Promise<MoneyFlow | null> {
  const graph = await buildPoliticianFundingGraph(slug, filters);
  if (!graph) return null;

  const allSources = collectSources(graph);
  const { shown, remainder } = topSourcesWithRemainder(allSources, MONEY_FLOW_SOURCE_LIMIT);

  const cycleLabel = filters.cycle
    ? `${filters.cycle} cycle`
    : graph.availableFilters.cycles.length > 0
      ? `${graph.availableFilters.cycles.join(" + ")} cycles`
      : "No cycle data yet";

  if (options.includeLobbying === false) {
    return {
      politician: graph.politician,
      totals: graph.totals,
      cycleLabel,
      sources: shown,
      remainder,
      bills: [],
      bothSides: [],
      lobbyingUnavailable: false,
    };
  }

  const lobbied = await getMostLobbiedBills({ sponsorId: graph.politician.id, limit: BILL_LIMIT })
    .catch(() => null);

  if (!lobbied) {
    return {
      politician: graph.politician,
      totals: graph.totals,
      cycleLabel,
      sources: shown,
      remainder,
      bills: [],
      bothSides: [],
      lobbyingUnavailable: true,
    };
  }

  const bills: MoneyFlowBill[] = lobbied.map((bill) => ({
    billId: bill.billId,
    number: bill.number,
    title: bill.title,
    status: bill.status,
    href: billHref(bill.billId),
    clients: bill.clients,
    reports: bill.reports,
  }));

  // One call per bill, and a failure on any of them only costs that bill's matches.
  const clientLists = await Promise.all(
    bills.map(async (bill) => {
      const lobbying = await getBillLobbying(bill.billId, CLIENTS_PER_BILL).catch(() => null);
      return {
        billId: bill.billId,
        number: bill.number,
        href: bill.href,
        // Fall back to the display name where a row carries no key, so a missing key is not a missing match.
        clientKeys: (lobbying?.rows ?? []).map((row) => row.clientKey || organizationKey(row.name)),
      };
    }),
  );

  return {
    politician: graph.politician,
    totals: graph.totals,
    cycleLabel,
    sources: shown,
    remainder,
    bills,
    bothSides: findBothSides(allSources, clientLists),
    lobbyingUnavailable: false,
  };
}
