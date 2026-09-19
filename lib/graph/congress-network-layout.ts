import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

/*
 * Positions for the Congress money network, computed once on the server.
 *
 * A force layout over the raw member-committee graph does not show much: a few hundred corporate
 * PACs each fund two hundred members, and they pull everything into one disc. So the layout is
 * built in two steps that each mean something:
 *
 * 1. Members are placed by how alike their donor lists are. Similarity is cosine over the set of
 *    committees that funded each member, weighted by inverse document frequency -- sharing a
 *    niche PAC says far more than sharing one that funds everybody. Each member keeps its
 *    strongest links and ForceAtlas2 lays that small graph out, so members with the most donors
 *    in common end up next to each other.
 * 2. Each committee sits at the money-weighted centre of the members it funded, nudged off that
 *    point so committees with the same recipients do not stack. Bipartisan corporate PACs land
 *    between the parties; labor and ideological PACs land on their side.
 *
 * Deterministic: the same data always produces the same picture.
 */

export interface LayoutInput {
  memberCount: number;
  memberParty: Array<"D" | "R" | "I">;
  committeeCount: number;
  /** Flat [committeeIndex, memberIndex, amount] triples. */
  edges: number[];
}

const NEIGHBORS_PER_MEMBER = 10;
const ITERATIONS = 600;

function hash01(value: number, salt: number) {
  let h = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function layoutCongressNetwork(input: LayoutInput) {
  const { memberCount, committeeCount, edges } = input;

  // Recipients of each committee.
  const recipients: number[][] = Array.from({ length: committeeCount }, () => []);
  for (let index = 0; index < edges.length; index += 3) {
    recipients[edges[index]].push(edges[index + 1]);
  }

  // Pairwise IDF-weighted overlap between members, accumulated committee by committee.
  const similarity = new Float64Array(memberCount * memberCount);
  const norm = new Float64Array(memberCount);
  for (const list of recipients) {
    if (list.length === 0) continue;
    const idf = Math.log((memberCount + 1) / list.length);
    const weight = idf * idf;
    for (const member of list) norm[member] += weight;
    if (list.length < 2) continue;
    for (let a = 0; a < list.length; a += 1) {
      for (let b = a + 1; b < list.length; b += 1) {
        similarity[list[a] * memberCount + list[b]] += weight;
        similarity[list[b] * memberCount + list[a]] += weight;
      }
    }
  }

  const graph = new Graph({ type: "undirected" });
  const partyX = { D: -1, R: 1, I: 0 } as const;
  for (let member = 0; member < memberCount; member += 1) {
    const angle = hash01(member, 1) * Math.PI * 2;
    graph.addNode(member, {
      x: partyX[input.memberParty[member]] + Math.cos(angle) * 0.5,
      y: Math.sin(angle) * 0.8,
    });
  }
  for (let member = 0; member < memberCount; member += 1) {
    if (norm[member] === 0) continue;
    const scored: Array<[number, number]> = [];
    for (let other = 0; other < memberCount; other += 1) {
      const shared = similarity[member * memberCount + other];
      if (other === member || shared === 0 || norm[other] === 0) continue;
      scored.push([other, shared / Math.sqrt(norm[member] * norm[other])]);
    }
    scored.sort((left, right) => right[1] - left[1]);
    for (const [other, cosine] of scored.slice(0, NEIGHBORS_PER_MEMBER)) {
      if (!graph.hasEdge(member, other)) graph.addEdge(member, other, { weight: cosine });
    }
  }

  forceAtlas2.assign(graph, {
    iterations: ITERATIONS,
    getEdgeWeight: "weight",
    settings: {
      ...forceAtlas2.inferSettings(graph),
      linLogMode: true,
      gravity: 1,
      scalingRatio: 4,
      strongGravityMode: true,
      edgeWeightInfluence: 1,
      slowDown: 2,
    },
  });

  // Normalize members into [-1, 1] so committee offsets below have a stable scale.
  const memberXY = new Float64Array(memberCount * 2);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  graph.forEachNode((key, attributes) => {
    minX = Math.min(minX, attributes.x);
    maxX = Math.max(maxX, attributes.x);
    minY = Math.min(minY, attributes.y);
    maxY = Math.max(maxY, attributes.y);
  });
  const scale = 2 / Math.max(maxX - minX, maxY - minY, 1e-9);
  graph.forEachNode((key, attributes) => {
    const member = Number(key);
    memberXY[member * 2] = (attributes.x - (minX + maxX) / 2) * scale;
    memberXY[member * 2 + 1] = (attributes.y - (minY + maxY) / 2) * scale;
  });

  // Committees at the money-weighted centre of their recipients.
  const committeeXY = new Float64Array(committeeCount * 2);
  const committeeTotal = new Float64Array(committeeCount);
  for (let index = 0; index < edges.length; index += 3) {
    const committee = edges[index];
    const member = edges[index + 1];
    const amount = edges[index + 2];
    committeeXY[committee * 2] += memberXY[member * 2] * amount;
    committeeXY[committee * 2 + 1] += memberXY[member * 2 + 1] * amount;
    committeeTotal[committee] += amount;
  }
  for (let committee = 0; committee < committeeCount; committee += 1) {
    const total = committeeTotal[committee] || 1;
    const count = recipients[committee].length || 1;
    // A single-recipient committee orbits its member; a widely spread one barely moves.
    const radius = 0.025 + 0.07 / Math.sqrt(count);
    const angle = hash01(committee, 7) * Math.PI * 2;
    const distance = radius * (0.35 + 0.65 * Math.sqrt(hash01(committee, 11)));
    committeeXY[committee * 2] = committeeXY[committee * 2] / total + Math.cos(angle) * distance;
    committeeXY[committee * 2 + 1] = committeeXY[committee * 2 + 1] / total + Math.sin(angle) * distance;
  }

  const round = (value: number) => Math.round(value * 10000) / 10000;
  return {
    members: Array.from(memberXY, round),
    committees: Array.from(committeeXY, round),
  };
}
