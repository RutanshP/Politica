import { fetchFecCandidateTotals, isFecConfigured, searchFecCandidatesByName } from "@/lib/adapters/fec";
import { getBillsData, isLiveBillsSource } from "@/lib/data/bills";
import {
  getPoliticianData,
  getPoliticiansData,
  isLivePoliticianSource,
} from "@/lib/data/politicians";
import type { FundingEdge, FundingNode } from "@/types/civic";

export type GraphDataSource =
  | "live-congress-relationships"
  | "live-fec-and-congress"
  | "unconfigured"
  | "unavailable";

export async function getFundingGraphData(politicianSlug?: string) {
  const [billsData, politiciansData] = await Promise.all([
    getBillsData(),
    getPoliticiansData(),
  ]);

  if (!isLiveBillsSource(billsData.source) || !isLivePoliticianSource(politiciansData.source)) {
    return {
      source:
        billsData.source === "unconfigured" && politiciansData.source === "unconfigured"
          ? ("unconfigured" as GraphDataSource)
          : ("unavailable" as GraphDataSource),
      graph: { nodes: [] as FundingNode[], edges: [] as FundingEdge[] },
    };
  }

  const selectedPolitician = politicianSlug
    ? (await getPoliticianData(politicianSlug)).politician
    : undefined;

  const candidateBills = selectedPolitician
    ? billsData.bills.filter((bill) => bill.sponsorId === selectedPolitician.id || bill.sponsorName === selectedPolitician.name)
    : billsData.bills.slice(0, 8);

  const politicianNodes = (selectedPolitician
    ? politiciansData.politicians.filter((politician) => politician.slug === selectedPolitician.slug)
    : politiciansData.politicians.slice(0, 6)
  ).map<FundingNode>((politician) => ({
    id: politician.slug,
    label: politician.name,
    type: "politician",
    detail: `${politician.party} · ${politician.state}`,
  }));

  const billNodes = candidateBills.map<FundingNode>((bill) => ({
    id: bill.id,
    label: bill.number,
    type: "bill",
    detail: bill.title,
  }));

  const issueNodes = [...new Set(candidateBills.map((bill) => bill.topic))].map<FundingNode>((topic) => ({
    id: `issue-${topic.toLowerCase().replace(/\s+/g, "-")}`,
    label: topic,
    type: "issue",
    detail: "Policy area from live bill data",
  }));

  const nodes = [...politicianNodes, ...billNodes, ...issueNodes];

  const billEdges = candidateBills
    .map<FundingEdge | null>((bill, index) => {
      const sponsorNode = politicianNodes.find((politician) => politician.label === bill.sponsorName);
      if (!sponsorNode) return null;

      return {
        id: `sponsor-${bill.id}-${index}`,
        source: sponsorNode.id,
        target: bill.id,
        label: "sponsored",
        amount: 0,
      };
    })
    .filter((edge): edge is FundingEdge => Boolean(edge));

  const issueEdges = candidateBills.map<FundingEdge>((bill, index) => ({
    id: `topic-${bill.id}-${index}`,
    source: bill.id,
    target: `issue-${bill.topic.toLowerCase().replace(/\s+/g, "-")}`,
    label: "belongs to",
    amount: 0,
  }));

  if (isFecConfigured() && politicianNodes.length > 0) {
    try {
      const fecNodes: FundingNode[] = [];
      const fecEdges: FundingEdge[] = [];

      for (const politician of politicianNodes.slice(0, 3)) {
        const candidateLookup = await searchFecCandidatesByName(politician.label);
        const candidate = candidateLookup.results?.[0];
        if (!candidate?.candidate_id) continue;

        const totals = await fetchFecCandidateTotals(candidate.candidate_id);
        const committee = totals.results?.[0];
        if (!committee?.committee_id) continue;

        fecNodes.push({
          id: committee.committee_id,
          label: committee.committee_name || "Campaign Committee",
          type: "pac",
          detail: `${candidate.office_full || "Federal candidate"} · ${candidate.party_full || "Unknown party"}`,
          amount: committee.receipts ? `$${Math.round(committee.receipts).toLocaleString()} receipts` : undefined,
        });

        fecEdges.push({
          id: `fec-${candidate.candidate_id}-${committee.committee_id}`,
          source: committee.committee_id,
          target: politician.id,
          label: "supports",
          amount: Math.round(committee.receipts || 0),
        });
      }

      if (fecNodes.length > 0) {
        return {
          source: "live-fec-and-congress" as GraphDataSource,
          graph: {
            nodes: [...nodes, ...fecNodes],
            edges: [...billEdges, ...issueEdges, ...fecEdges],
          },
        };
      }
    } catch {
      // Keep Congress-only graph.
    }
  }

  return {
    source: "live-congress-relationships" as GraphDataSource,
    graph: {
      nodes,
      edges: [...billEdges, ...issueEdges],
    },
  };
}

export function getGraphSourceLabel(source: GraphDataSource) {
  if (source === "live-fec-and-congress") {
    return "Live FEC + Congress graph";
  }

  if (source === "live-congress-relationships") {
    return "Live Congress relationship graph";
  }

  return source === "unconfigured"
    ? "Congress.gov API not configured"
    : "Graph data unavailable";
}

export function isLiveGraphSource(source: GraphDataSource) {
  return source === "live-congress-relationships" || source === "live-fec-and-congress";
}
