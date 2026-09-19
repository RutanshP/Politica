import Graph from "graphology";

import type { CongressNetwork, NetworkChamber, NetworkParty } from "@/lib/graph/congress-network-wire";
import type { PacCategory } from "@/lib/graph/pac-classification";

/*
 * Pure graph construction and queries for the Congress money network -- no DOM, no sigma -- so
 * the canvas component only has to render what this decides.
 *
 * Node keys are prefixed, `m:` for members and `c:` for committees, because a bioguide id and an
 * FEC committee id live in different namespaces and nothing guarantees they never collide.
 */

export const PARTY_COLOR: Record<NetworkParty, string> = {
  D: "#3b82f6",
  R: "#ef4444",
  I: "#a78bfa",
};

export const PARTY_LABEL: Record<NetworkParty, string> = {
  D: "Democrat",
  R: "Republican",
  I: "Independent",
};

export const CATEGORY_COLOR: Record<PacCategory, string> = {
  corporate: "#f59e0b",
  trade: "#2dd4bf",
  labor: "#4ade80",
  ideological: "#e879f9",
  super_pac: "#fb7185",
  party: "#94a3b8",
  leadership: "#38bdf8",
  campaign: "#cbd5e1",
};

export const CATEGORY_ORDER: PacCategory[] = [
  "corporate",
  "trade",
  "labor",
  "ideological",
  "leadership",
  "party",
  "super_pac",
  "campaign",
];

export const DIM_NODE_COLOR = "#1a2133";

export interface MemberAttributes {
  kind: "member";
  index: number;
  /** Canvas label. */
  label: string;
  /** Full name, for panels and search. */
  name: string;
  party: NetworkParty;
  chamber: NetworkChamber;
  x: number;
  y: number;
  size: number;
  color: string;
  /** Dollars received from committees in the network. */
  total: number;
}

export interface CommitteeAttributes {
  kind: "committee";
  index: number;
  /** Canvas label, shortened -- committee names run past 80 characters. */
  label: string;
  name: string;
  category: PacCategory;
  x: number;
  y: number;
  size: number;
  color: string;
  /** Dollars given to members in the network. */
  total: number;
  /** Member key of whoever runs this committee, if anyone does. */
  owner: string | null;
}

export type NodeAttributes = MemberAttributes | CommitteeAttributes;

export interface EdgeAttributes {
  kind: "gift" | "owns";
  amount: number;
  weight: number;
}

export type NetworkGraph = Graph<NodeAttributes, EdgeAttributes>;

export const memberKey = (id: string) => `m:${id}`;
export const committeeKey = (id: string) => `c:${id}`;

const LABEL_MAX = 34;

/** "Service Employees International Union Committee on Political Education" fits a canvas poorly. */
export function shortLabel(name: string) {
  const clean = name.replace(/s*([^)]*)s*$/, "").trim() || name;
  return clean.length <= LABEL_MAX ? clean : `${clean.slice(0, LABEL_MAX - 1).replace(/s+S*$/, "")}…`;
}

export function buildNetworkGraph(network: CongressNetwork): NetworkGraph {
  const graph: NetworkGraph = new Graph({ type: "undirected", multi: false, allowSelfLoops: false });

  const memberTotals = new Array<number>(network.members.length).fill(0);
  const committeeTotals = new Array<number>(network.committees.length).fill(0);
  for (let index = 0; index < network.edges.length; index += 3) {
    committeeTotals[network.edges[index]] += network.edges[index + 2];
    memberTotals[network.edges[index + 1]] += network.edges[index + 2];
  }
  const maxMember = Math.max(1, ...memberTotals);
  const maxCommittee = Math.max(1, ...committeeTotals);

  // Positions come from the server (lib/graph/congress-network-layout.ts): members placed by
  // shared donors, committees at the money-weighted centre of whoever they funded. Screen y runs
  // down, so it is flipped to keep the server's orientation.
  network.members.forEach((member, index) => {
    graph.addNode(memberKey(member.id), {
      kind: "member",
      index,
      label: member.name,
      name: member.name,
      party: member.party,
      chamber: member.chamber,
      x: network.memberPositions[index * 2] ?? 0,
      y: -(network.memberPositions[index * 2 + 1] ?? 0),
      size: 3.5 + 9 * Math.sqrt(memberTotals[index] / maxMember),
      color: PARTY_COLOR[member.party],
      total: memberTotals[index],
    });
  });

  network.committees.forEach((committee, index) => {
    graph.addNode(committeeKey(committee.id), {
      kind: "committee",
      index,
      label: shortLabel(committee.name),
      name: committee.name,
      category: committee.category,
      x: network.committeePositions[index * 2] ?? 0,
      y: -(network.committeePositions[index * 2 + 1] ?? 0),
      size: 1.4 + 6 * Math.sqrt(committeeTotals[index] / maxCommittee),
      color: CATEGORY_COLOR[committee.category],
      total: committeeTotals[index],
      owner: committee.owner === null ? null : memberKey(network.members[committee.owner].id),
    });
  });

  for (let index = 0; index < network.edges.length; index += 3) {
    const source = committeeKey(network.committees[network.edges[index]].id);
    const target = memberKey(network.members[network.edges[index + 1]].id);
    const amount = network.edges[index + 2];
    graph.mergeEdge(source, target, { kind: "gift", amount, weight: Math.log10(Math.max(amount, 10)) });
  }

  // A leadership PAC or campaign belongs to a member: tie it to them, so money from one member's
  // PAC to another reads as the member-to-member connection it is.
  graph.forEachNode((key, attributes) => {
    if (attributes.kind === "committee" && attributes.owner && graph.hasNode(attributes.owner) && !graph.hasEdge(key, attributes.owner)) {
      graph.addEdge(attributes.owner, key, { kind: "owns", amount: 0, weight: 3 });
    }
  });

  return graph;
}

export interface NetworkFilters {
  parties: Set<NetworkParty>;
  chambers: Set<NetworkChamber>;
  categories: Set<PacCategory>;
  minAmount: number;
}

export interface Visibility {
  nodes: Set<string>;
  edges: Set<string>;
}

/**
 * Which nodes and edges the filters admit. A committee is shown only while at least one of its
 * gifts is, so filtering to the Senate does not leave thousands of orphaned House donors behind.
 */
export function computeVisibility(graph: NetworkGraph, filters: NetworkFilters): Visibility {
  const nodes = new Set<string>();
  const edges = new Set<string>();

  graph.forEachNode((key, attributes) => {
    if (attributes.kind === "member" && filters.parties.has(attributes.party) && filters.chambers.has(attributes.chamber)) {
      nodes.add(key);
    }
  });

  graph.forEachEdge((edge, attributes, source, target, sourceAttributes, targetAttributes) => {
    const member = sourceAttributes.kind === "member" ? source : target;
    const committee = sourceAttributes.kind === "committee" ? sourceAttributes : targetAttributes;
    if (!nodes.has(member) || committee.kind !== "committee" || !filters.categories.has(committee.category)) return;
    if (attributes.kind === "gift" && attributes.amount < filters.minAmount) return;
    edges.add(edge);
  });

  graph.forEachEdge((edge, attributes, source, target) => {
    if (!edges.has(edge) || attributes.kind !== "gift") return;
    nodes.add(graph.getNodeAttribute(source, "kind") === "committee" ? source : target);
  });
  // An ownership tie only survives if the committee itself is still on screen.
  for (const edge of [...edges]) {
    const [source, target] = graph.extremities(edge);
    if (!nodes.has(source) || !nodes.has(target)) edges.delete(edge);
  }

  return { nodes, edges };
}

export interface Connection {
  key: string;
  label: string;
  amount: number;
  color: string;
  detail: string;
}

/** The visible gifts touching one node, largest first. */
export function connectionsOf(graph: NetworkGraph, node: string, visibility: Visibility): Connection[] {
  const rows: Connection[] = [];
  graph.forEachEdge(node, (edge, attributes, source, target) => {
    if (!visibility.edges.has(edge) || attributes.kind !== "gift") return;
    const other = source === node ? target : source;
    const otherAttributes = graph.getNodeAttributes(other);
    rows.push({
      key: other,
      label: otherAttributes.name,
      amount: attributes.amount,
      color: otherAttributes.color,
      detail: otherAttributes.kind === "member" ? `${otherAttributes.party} · ${otherAttributes.chamber}` : otherAttributes.category,
    });
  });
  return rows.sort((left, right) => right.amount - left.amount);
}

export interface SimilarMember {
  key: string;
  label: string;
  color: string;
  shared: number;
  /** Share of the smaller donor list that overlaps, 0..1. */
  overlap: number;
}

/**
 * Members funded by the most of the same committees -- the "interconnected" read of the network.
 * Ranked by shared count with an overlap floor, so a member with three donors who all also gave
 * here does not outrank one sharing two hundred.
 */
export function membersSharingDonors(graph: NetworkGraph, member: string, visibility: Visibility, limit = 8): SimilarMember[] {
  const donors = new Set<string>();
  graph.forEachEdge(member, (edge, attributes, source, target) => {
    if (visibility.edges.has(edge) && attributes.kind === "gift") donors.add(source === member ? target : source);
  });

  const shared = new Map<string, number>();
  for (const donor of donors) {
    graph.forEachEdge(donor, (edge, attributes, source, target) => {
      if (!visibility.edges.has(edge) || attributes.kind !== "gift") return;
      const other = source === donor ? target : source;
      if (other !== member) shared.set(other, (shared.get(other) || 0) + 1);
    });
  }

  return [...shared.entries()]
    .map(([key, count]) => {
      const attributes = graph.getNodeAttributes(key);
      const otherDonors = graph.degree(key);
      return {
        key,
        label: attributes.name,
        color: attributes.color,
        shared: count,
        overlap: count / Math.max(1, Math.min(donors.size, otherDonors)),
      };
    })
    .sort((left, right) => right.shared - left.shared || right.overlap - left.overlap)
    .slice(0, limit);
}

/** Dollars from a committee split by recipient party. */
export function partySplit(graph: NetworkGraph, committee: string, visibility: Visibility) {
  const split: Record<NetworkParty, number> = { D: 0, R: 0, I: 0 };
  graph.forEachEdge(committee, (edge, attributes, source, target) => {
    if (!visibility.edges.has(edge) || attributes.kind !== "gift") return;
    const other = graph.getNodeAttributes(source === committee ? target : source);
    if (other.kind === "member") split[other.party] += attributes.amount;
  });
  return split;
}

/** Dollars into a member split by committee category. */
export function categorySplit(graph: NetworkGraph, member: string, visibility: Visibility) {
  const split = new Map<PacCategory, number>();
  graph.forEachEdge(member, (edge, attributes, source, target) => {
    if (!visibility.edges.has(edge) || attributes.kind !== "gift") return;
    const other = graph.getNodeAttributes(source === member ? target : source);
    if (other.kind === "committee") split.set(other.category, (split.get(other.category) || 0) + attributes.amount);
  });
  return CATEGORY_ORDER.filter((category) => split.has(category)).map((category) => ({ category, amount: split.get(category)! }));
}

export function formatDollars(amount: number) {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(amount >= 10_000 ? 0 : 1)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}
