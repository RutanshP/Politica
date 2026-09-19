import type { PacCategory } from "@/lib/graph/pac-classification";

/*
 * The Congress money network as the browser receives it. Kept apart from lib/data/congress-network.ts
 * so the client can decode it without bundling the Supabase reader or the server-side layout.
 */

export type NetworkParty = "D" | "R" | "I";
export type NetworkChamber = "House" | "Senate";

export interface NetworkMember {
  id: string;
  slug: string;
  name: string;
  party: NetworkParty;
  state: string;
  chamber: NetworkChamber;
  district: string | null;
}

export interface NetworkCommittee {
  id: string;
  name: string;
  category: PacCategory;
  /** Index into `members` of the member who runs this committee (leadership PACs, campaigns). */
  owner: number | null;
  connectedOrg: string | null;
}

export interface CongressNetwork {
  cycle: number;
  members: NetworkMember[];
  committees: NetworkCommittee[];
  /** Flat [committeeIndex, memberIndex, amountInDollars] triples. */
  edges: number[];
  /** Flat [x, y] pairs, members then committees -- see lib/graph/congress-network-layout.ts. */
  memberPositions: number[];
  committeePositions: number[];
  generatedAt: string;
}

/**
 * The wire form: committees as `[id, name, category, ownerIndex | -1, connectedOrg | ""]`.
 * Six thousand committees as objects repeat the same five keys six thousand times.
 */
export type CommitteeTuple = [string, string, PacCategory, number, string];
export type CongressNetworkWire = Omit<CongressNetwork, "committees"> & { committees: CommitteeTuple[] };

export function encodeNetwork(network: CongressNetwork): CongressNetworkWire {
  return {
    ...network,
    committees: network.committees.map((committee) => [
      committee.id,
      committee.name,
      committee.category,
      committee.owner ?? -1,
      committee.connectedOrg ?? "",
    ]),
  };
}

export function decodeNetwork(wire: CongressNetworkWire): CongressNetwork {
  return {
    ...wire,
    committees: wire.committees.map(([id, name, category, owner, connectedOrg]) => ({
      id,
      name,
      category,
      owner: owner >= 0 ? owner : null,
      connectedOrg: connectedOrg || null,
    })),
  };
}
