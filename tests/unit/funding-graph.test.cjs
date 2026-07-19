const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const {
  rankFinancialEdges,
  filterEdgesByCycle,
  filterEdgesByAmount,
  dedupeEntities,
  pruneDisconnected,
  enforceNodeLimit,
  formatRelationshipLabel,
  mapEntityToNode,
  mapEdgeRowToEdge,
} = jiti("@/lib/graph/funding-graph-utils");
const { layoutFundingGraph } = jiti("@/lib/graph/funding-graph-layout");
const { computeTotalsFromEdges } = jiti("@/lib/graph/build-politician-funding-graph");
const { parseFundingGraphQuery, serializeFundingGraphFilters } = jiti("@/lib/graph/funding-graph-params");

function edgeRow(overrides = {}) {
  return {
    id: overrides.id || `edge-${Math.random()}`,
    source_entity_id: "a",
    target_entity_id: "b",
    relationship_type: "contributed_to",
    relationship_direction: "directed",
    amount: null,
    transaction_count: null,
    election_cycle: null,
    occurred_at: null,
    start_date: null,
    end_date: null,
    is_aggregate: false,
    confidence: 1,
    metadata: {},
    source_system: "test",
    source_id: "test",
    source_url: null,
    synced_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function node(id, entityType, amount) {
  return { id, data: { label: id, entityType, amount } };
}

function graphEdge(id, source, target, overrides = {}) {
  return {
    id,
    source,
    target,
    data: {
      relationshipType: "contributed_to",
      label: "contributed to",
      isAggregate: false,
      sourceCount: 1,
      ...overrides,
    },
  };
}

test("rankFinancialEdges orders by amount, then transactions, then recency, then directness", () => {
  const edges = [
    edgeRow({ id: "small", amount: 100 }),
    edgeRow({ id: "big", amount: 900 }),
    edgeRow({ id: "sameAmountMoreTxns", amount: 500, transaction_count: 10 }),
    edgeRow({ id: "sameAmountFewerTxns", amount: 500, transaction_count: 2 }),
    edgeRow({ id: "aggregate", amount: 300, is_aggregate: true }),
    edgeRow({ id: "direct", amount: 300, is_aggregate: false }),
  ];
  const ranked = rankFinancialEdges(edges).map((edge) => edge.id);
  assert.equal(ranked[0], "big");
  assert.ok(ranked.indexOf("sameAmountMoreTxns") < ranked.indexOf("sameAmountFewerTxns"));
  assert.ok(ranked.indexOf("direct") < ranked.indexOf("aggregate"));
  assert.equal(ranked.at(-1), "small");
});

test("filterEdgesByCycle keeps structural edges but drops other-cycle financial edges", () => {
  const edges = [
    edgeRow({ id: "cycle2024", election_cycle: 2024 }),
    edgeRow({ id: "cycle2022", election_cycle: 2022 }),
    edgeRow({ id: "structural", election_cycle: null, relationship_type: "affiliated_with" }),
    // Structural edges survive even when a sync stamped a cycle on them --
    // otherwise a committee->politician affiliation from one cycle would
    // disconnect the whole money side when viewing another cycle.
    edgeRow({ id: "structuralStamped", election_cycle: 2024, relationship_type: "affiliated_with" }),
  ];
  const filtered2024 = filterEdgesByCycle(edges, 2024).map((edge) => edge.id);
  assert.deepEqual(filtered2024, ["cycle2024", "structural", "structuralStamped"]);
  const filtered2022 = filterEdgesByCycle(edges, 2022).map((edge) => edge.id);
  assert.deepEqual(filtered2022, ["cycle2022", "structural", "structuralStamped"]);
  assert.equal(filterEdgesByCycle(edges, undefined).length, 4);
});

test("filterEdgesByAmount bounds only edges that carry amounts", () => {
  const edges = [
    edgeRow({ id: "tiny", amount: 50 }),
    edgeRow({ id: "mid", amount: 5000 }),
    edgeRow({ id: "huge", amount: 900000 }),
    edgeRow({ id: "structural", amount: null }),
  ];
  const filtered = filterEdgesByAmount(edges, 1000, 100000).map((edge) => edge.id);
  assert.deepEqual(filtered, ["mid", "structural"]);
});

test("dedupeEntities keeps one row per id", () => {
  const entities = [
    { id: "x", label: "first" },
    { id: "x", label: "duplicate" },
    { id: "y", label: "second" },
  ];
  const deduped = dedupeEntities(entities);
  assert.equal(deduped.length, 2);
});

test("pruneDisconnected removes nodes unreachable from the center", () => {
  const nodes = [node("center", "politician"), node("linked", "pac"), node("orphan", "pac")];
  const edges = [graphEdge("e1", "linked", "center")];
  const pruned = pruneDisconnected("center", nodes, edges);
  assert.deepEqual(pruned.nodes.map((item) => item.id).sort(), ["center", "linked"]);
});

test("enforceNodeLimit pins center and candidate committees and keeps highest-weight nodes", () => {
  const nodes = [
    node("center", "politician"),
    node("committee", "candidateCommittee"),
    node("bigDonor", "donorAggregate"),
    node("smallDonor", "donorAggregate"),
    node("tinyDonor", "donorAggregate"),
  ];
  const edges = [
    graphEdge("ec", "committee", "center", { relationshipType: "affiliated_with" }),
    graphEdge("e1", "bigDonor", "committee", { amount: 900000 }),
    graphEdge("e2", "smallDonor", "committee", { amount: 500 }),
    graphEdge("e3", "tinyDonor", "committee", { amount: 5 }),
  ];
  const limited = enforceNodeLimit("center", nodes, edges, 3);
  assert.equal(limited.truncated, true);
  const ids = limited.nodes.map((item) => item.id);
  assert.ok(ids.includes("center"));
  assert.ok(ids.includes("committee"));
  assert.ok(ids.includes("bigDonor"));
  assert.ok(!ids.includes("tinyDonor"));
  assert.ok(limited.edges.every((edge) => ids.includes(edge.source) && ids.includes(edge.target)));
});

test("enforceNodeLimit is a no-op under the limit", () => {
  const nodes = [node("center", "politician"), node("donor", "pac")];
  const edges = [graphEdge("e1", "donor", "center", { amount: 100 })];
  const limited = enforceNodeLimit("center", nodes, edges, 30);
  assert.equal(limited.truncated, false);
  assert.equal(limited.nodes.length, 2);
});

test("aggregate contribution edges are labeled as aggregates, not direct gifts", () => {
  assert.equal(formatRelationshipLabel("contributed_to", true), "aggregated contributions");
  assert.equal(formatRelationshipLabel("contributed_to", false), "contributed to");
  assert.equal(
    formatRelationshipLabel("employee_contributions", true),
    "associated employee contributions",
  );
});

test("mapEntityToNode marks employer/industry aggregates and strips nested metadata", () => {
  const nodeResult = mapEntityToNode({
    id: "agg-1",
    slug: "agg-1",
    entity_type: "employer",
    label: "Employees of X",
    subtitle: "Aggregated",
    image_url: null,
    metadata: { aggregationType: "by employer", contributorCount: 12, nested: { drop: true } },
    source_system: "demo_fixture",
    source_id: "agg-1",
    source_url: null,
    synced_at: "2026-01-01T00:00:00Z",
  });
  assert.equal(nodeResult.data.isAggregate, true);
  assert.equal(nodeResult.data.metadata.contributorCount, 12);
  assert.equal(nodeResult.data.metadata.nested, undefined);
});

test("mapEdgeRowToEdge carries amounts, cycle, and aggregate flag", () => {
  const edge = mapEdgeRowToEdge(
    edgeRow({ id: "e", amount: 1000, election_cycle: 2024, is_aggregate: true, transaction_count: 4 }),
    7,
  );
  assert.equal(edge.data.amount, 1000);
  assert.equal(edge.data.electionCycle, 2024);
  assert.equal(edge.data.isAggregate, true);
  assert.equal(edge.data.sourceCount, 7);
});

test("layoutFundingGraph puts money left, politician center, legislative right", () => {
  const nodes = [
    node("center", "politician"),
    node("cmte", "candidateCommittee"),
    node("donor", "donorAggregate"),
    node("company", "company"),
    node("bill", "bill"),
  ];
  const edges = [
    graphEdge("e1", "donor", "cmte", { amount: 1000 }),
    graphEdge("e2", "cmte", "center", { relationshipType: "affiliated_with" }),
    graphEdge("e3", "company", "donor", { relationshipType: "affiliated_with" }),
    graphEdge("e4", "center", "bill", { relationshipType: "sponsored" }),
  ];
  const positioned = layoutFundingGraph("center", nodes, edges);
  const byId = new Map(positioned.map((item) => [item.id, item.position]));
  assert.ok(byId.get("donor").x < byId.get("center").x, "money is left of center");
  assert.ok(byId.get("company").x < byId.get("donor").x, "second-degree money is further left");
  assert.ok(byId.get("bill").x > byId.get("center").x, "legislation is right of center");
  assert.equal(byId.get("cmte").x, byId.get("center").x, "candidate committee shares center column");
  // Selection must not affect layout: same inputs -> same positions.
  const again = layoutFundingGraph("center", nodes, edges);
  assert.deepEqual(positioned, again);
});

test("computeTotalsFromEdges splits individual, PAC, small-dollar subset, and IE totals", () => {
  const entities = new Map([
    ["ind", { id: "ind", entity_type: "donorAggregate" }],
    ["small", { id: "small", entity_type: "donorAggregate" }],
    ["pac", { id: "pac", entity_type: "pac" }],
    ["ie", { id: "ie", entity_type: "independentExpenditureGroup" }],
    ["cmte", { id: "cmte", entity_type: "candidateCommittee" }],
  ]);
  const totals = computeTotalsFromEdges(
    [
      edgeRow({ source_entity_id: "ind", target_entity_id: "cmte", amount: 1000 }),
      edgeRow({ source_entity_id: "small", target_entity_id: "cmte", amount: 600, metadata: { subsetOf: "x" } }),
      edgeRow({ source_entity_id: "pac", target_entity_id: "cmte", amount: 400 }),
      edgeRow({ source_entity_id: "ie", target_entity_id: "pol", amount: 250, relationship_type: "independent_spending_support" }),
    ],
    entities,
  );
  assert.equal(totals.individualContributions, 1000);
  assert.equal(totals.smallDollarContributions, 600);
  assert.equal(totals.pacContributions, 400);
  assert.equal(totals.totalReceipts, 1400);
  assert.equal(totals.independentSupport, 250);
  assert.equal(totals.smallDollarPercentage, 60);
});

test("parseFundingGraphQuery validates, defaults, and caps unfiltered limits", () => {
  const defaults = parseFundingGraphQuery(new URLSearchParams());
  assert.equal(defaults.ok, true);
  assert.equal(defaults.filters.limit, 30);
  assert.equal(defaults.filters.groupSmallDonors, true);

  const bad = parseFundingGraphQuery(new URLSearchParams("nodeTypes=hacker"));
  assert.equal(bad.ok, false);

  // >100 nodes without narrowing filters gets clamped to 100.
  const wide = parseFundingGraphQuery(new URLSearchParams("limit=150"));
  assert.equal(wide.ok, true);
  assert.equal(wide.filters.limit, 100);

  // With a narrowing filter the higher limit is allowed.
  const narrowed = parseFundingGraphQuery(new URLSearchParams("limit=150&cycle=2024"));
  assert.equal(narrowed.ok, true);
  assert.equal(narrowed.filters.limit, 150);
});

test("serializeFundingGraphFilters round-trips through parseFundingGraphQuery", () => {
  const filters = {
    cycle: 2024,
    depth: 2,
    minimumAmount: 1000,
    nodeTypes: ["pac", "donorAggregate"],
    groupSmallDonors: false,
    showLegislative: true,
    showLobbying: false,
    showIndependentExpenditures: true,
    limit: 60,
  };
  const parsed = parseFundingGraphQuery(serializeFundingGraphFilters(filters));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.filters.cycle, 2024);
  assert.equal(parsed.filters.minimumAmount, 1000);
  assert.deepEqual(parsed.filters.nodeTypes, ["pac", "donorAggregate"]);
  assert.equal(parsed.filters.groupSmallDonors, false);
  assert.equal(parsed.filters.showLobbying, false);
  assert.equal(parsed.filters.limit, 60);
});
