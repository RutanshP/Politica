const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const {
  buildFecGraphRows,
  pickFecCandidateId,
  isRealEmployer,
} = jiti("@/lib/graph/fec-graph-normalizer");

const POLITICIAN = {
  id: "O000172",
  slug: "alexandria-ocasio-cortez",
  name: "Alexandria Ocasio-Cortez",
  title: "US Representative",
  party: "Democratic",
  state: "New York",
  district: "NY-14",
};

function payloads(overrides = {}) {
  return {
    cycle: 2026,
    totals: [{
      receipts: 1000000,
      disbursements: 400000,
      cash_on_hand_end_period: 600000,
      individual_itemized_contributions: 300000,
      individual_unitemized_contributions: 450000,
      other_political_committee_contributions: 90000,
      political_party_committee_contributions: 10000,
      candidate_contribution: 5000,
    }],
    committees: [
      { committee_id: "C001", name: "Other Committee", designation: "J", designation_full: "Joint fundraiser" },
      { committee_id: "C00639591", name: "AOC for Congress", designation: "P", designation_full: "Principal campaign committee" },
    ],
    byEmployer: [
      { employer: "RETIRED", total: 999999, count: 5000 },
      { employer: "NOT EMPLOYED", total: 888888, count: 4000 },
      { employer: "Alphabet", total: 42000, count: 210 },
      { employer: "SELF-EMPLOYED", total: 77777, count: 300 },
      { employer: "City University of New York", total: 18000, count: 90 },
    ],
    bySize: [
      { size: 0, total: 450000, count: null },
      { size: 200, total: 120000, count: 800 },
    ],
    scheduleE: [
      { support_oppose_indicator: "S", total: 150000, count: 12 },
      { support_oppose_indicator: "O", total: 80000, count: 7 },
    ],
    ...overrides,
  };
}

test("pickFecCandidateId matches the office prefix and prefers the newest id", () => {
  assert.equal(pickFecCandidateId(["H8NY15148"], "US Representative"), "H8NY15148");
  assert.equal(pickFecCandidateId(["H4MA00000", "S6MA00001"], "US Senator"), "S6MA00001");
  assert.equal(pickFecCandidateId(["H4MA00000", "H8MA00002", "S6MA00001"], "US Representative"), "H8MA00002");
  // No prefix match: fall back to the newest id.
  assert.equal(pickFecCandidateId(["P00003392"], "US Senator"), "P00003392");
});

test("isRealEmployer filters non-employment statuses", () => {
  assert.equal(isRealEmployer("Alphabet"), true);
  assert.equal(isRealEmployer("RETIRED"), false);
  assert.equal(isRealEmployer("self-employed"), false);
  assert.equal(isRealEmployer(" not employed "), false);
  assert.equal(isRealEmployer(null), false);
});

test("buildFecGraphRows maps totals into tile-ready numbers", () => {
  const { totals } = buildFecGraphRows(POLITICIAN, "H8NY15148", payloads());
  assert.equal(totals.totalReceipts, 1000000);
  assert.equal(totals.individualContributions, 750000);
  assert.equal(totals.pacContributions, 100000);
  assert.equal(totals.smallDollarContributions, 450000);
  assert.equal(totals.smallDollarPercentage, 60);
  assert.equal(totals.selfFunding, 5000);
  assert.equal(totals.independentSupport, 150000);
  assert.equal(totals.independentOpposition, 80000);
});

test("buildFecGraphRows wires money edges into the principal committee, IEs into the politician", () => {
  const { entities, edges } = buildFecGraphRows(POLITICIAN, "H8NY15148", payloads());
  const entityIds = new Set(entities.map((entity) => entity.id));

  assert.ok(entityIds.has("pol-O000172"));
  assert.ok(entityIds.has("fec-cmte-C00639591"), "principal (P) committee chosen over joint fundraiser");

  // Tier 2 -> center: the individual-donors hub and the PAC aggregate contribute
  // straight to the principal committee.
  const hubEdges = edges.filter((edge) =>
    edge.relationship_type === "contributed_to"
    && ["fec-ind-O000172", "fec-pacagg-O000172"].includes(edge.source_entity_id));
  assert.equal(hubEdges.length, 2, "individual hub + PAC aggregate feed the committee");
  assert.ok(hubEdges.every((edge) => edge.target_entity_id === "fec-cmte-C00639591"));
  assert.ok(hubEdges.every((edge) => edge.is_aggregate === true), "totals-derived edges are aggregates");
  assert.ok(hubEdges.every((edge) => edge.election_cycle === 2026));

  const ieEdges = edges.filter((edge) => edge.relationship_type.startsWith("independent_spending"));
  assert.equal(ieEdges.length, 2);
  assert.ok(ieEdges.every((edge) => edge.target_entity_id === "pol-O000172"), "IEs bypass the campaign committee");

  const affiliation = edges.find((edge) => edge.relationship_type === "affiliated_with");
  assert.equal(affiliation.election_cycle, null, "structural edge carries no cycle");
});

test("buildFecGraphRows labels employer aggregates and skips non-employers", () => {
  const { entities, edges } = buildFecGraphRows(POLITICIAN, "H8NY15148", payloads());
  const employerEntities = entities.filter((entity) => entity.entity_type === "employer");
  const labels = employerEntities.map((entity) => entity.label);

  assert.deepEqual(labels.sort(), ["Alphabet", "City University of New York"]);
  assert.ok(employerEntities.every((entity) =>
    String(entity.metadata.methodology).includes("not a contribution by the organization")));

  const employerEdges = edges.filter((edge) => edge.relationship_type === "employee_contributions");
  assert.equal(employerEdges.length, 2);
  assert.ok(employerEdges.every((edge) => edge.is_aggregate === true));
  assert.ok(employerEdges.every((edge) => edge.target_entity_id === "fec-ind-O000172"),
    "employer aggregates feed the individual-donors hub (tier 1 -> tier 2), not the committee");
});

test("buildFecGraphRows builds a three-tier money flow into the committee", () => {
  const { edges } = buildFecGraphRows(POLITICIAN, "H8NY15148", payloads());

  // Tier 1 -> tier 2: employers and small-dollar feed the individual-donors hub.
  const intoHub = edges.filter((edge) => edge.target_entity_id === "fec-ind-O000172");
  assert.ok(intoHub.some((edge) => edge.source_entity_id.startsWith("fec-emp-")), "employers feed the hub");
  assert.ok(intoHub.some((edge) => edge.source_entity_id === "fec-small-O000172"), "small-dollar feeds the hub");

  // Tier 2 -> center: the hub itself contributes to the committee.
  const hubOut = edges.find((edge) => edge.source_entity_id === "fec-ind-O000172");
  assert.equal(hubOut.target_entity_id, "fec-cmte-C00639591", "the hub contributes to the committee");

  // Tier-1 sources never bypass the hub (that would flatten the graph back to a star).
  const bypass = edges.filter((edge) =>
    (edge.source_entity_id.startsWith("fec-emp-") || edge.source_entity_id === "fec-small-O000172")
    && edge.target_entity_id === "fec-cmte-C00639591");
  assert.equal(bypass.length, 0, "tier-1 sources route through the hub, not straight to the committee");
});

test("buildFecGraphRows merges employer spellings that share a slug into one edge", () => {
  // FEC reports the same employer under several spellings; they normalize to one
  // slug and must merge, or the chunk emits two edges with the same id and the
  // upsert batch fails (Postgres 21000).
  const { entities, edges } = buildFecGraphRows(POLITICIAN, "H8NY15148", payloads({
    byEmployer: [
      { employer: "GOOGLE", total: 20000, count: 100 },
      { employer: "Google", total: 15000, count: 80 },
      { employer: "  google ", total: 5000, count: 20 },
    ],
  }));

  const googleEntities = entities.filter((entity) => entity.id === "fec-emp-google");
  assert.equal(googleEntities.length, 1, "one merged employer entity");

  const googleEdges = edges.filter((edge) => edge.source_entity_id === "fec-emp-google");
  assert.equal(googleEdges.length, 1, "one merged employer edge (no duplicate id)");
  assert.equal(googleEdges[0].amount, 40000, "merged edge sums the variant totals");
  assert.equal(googleEdges[0].transaction_count, 200, "merged edge sums the variant counts");

  const edgeIds = edges.map((edge) => edge.id);
  assert.equal(new Set(edgeIds).size, edgeIds.length, "no duplicate edge ids in the batch");
});

test("buildFecGraphRows marks small-dollar as a subset of individual giving", () => {
  const { edges } = buildFecGraphRows(POLITICIAN, "H8NY15148", payloads());
  const smallEdge = edges.find((edge) => edge.source_entity_id === "fec-small-O000172");
  assert.ok(smallEdge);
  assert.ok(smallEdge.metadata.subsetOf, "flagged so totals derivation never double-counts it");
});

test("buildFecGraphRows produces a finance snapshot row", () => {
  const { snapshot } = buildFecGraphRows(POLITICIAN, "H8NY15148", payloads());
  assert.equal(snapshot.id, "O000172-2026");
  assert.equal(snapshot.politician_id, "O000172");
  assert.equal(snapshot.receipts, 1000000);
  assert.equal(snapshot.disbursements, 400000);
  assert.equal(snapshot.cash_on_hand, 600000);
  assert.equal(snapshot.source_system, "fec_sync");
});

test("buildFecGraphRows omits zero-amount aggregates entirely", () => {
  const { entities, edges } = buildFecGraphRows(POLITICIAN, "H8NY15148", payloads({
    totals: [{ receipts: 0 }],
    byEmployer: [],
    bySize: [],
    scheduleE: [],
  }));
  assert.deepEqual(
    entities.map((entity) => entity.entity_type).sort(),
    ["candidateCommittee", "politician"],
  );
  assert.equal(edges.filter((edge) => edge.relationship_type === "contributed_to").length, 0);
});
