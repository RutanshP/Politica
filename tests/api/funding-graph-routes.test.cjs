const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const fundingGraphRoute = jiti("@/app/api/politicians/[slug]/funding-graph/route");
const neighborsRoute = jiti("@/app/api/graph/entities/[entityId]/neighbors/route");
const recordsRoute = jiti("@/app/api/graph/edges/[edgeId]/records/route");

const POLITICIAN_ROW = {
  id: "P1",
  slug: "test-pol",
  name: "Test Politician",
  title: "US Representative",
  party: "Independent",
  state: "Vermont",
  district: "VT-AL",
  biography: "Test bio",
  born: "1970",
  education: "Test U",
  occupation: "Legislator",
  website: "https://example.gov",
  office_phone: "202-555-0100",
  office_address: "1 Capitol Way",
  next_election: "2026",
  stats: { votesWithParty: 10, votesAgainstParty: 2, attendance: 97, billsIntroduced: 3, billsPassed: 1, amendmentsOffered: 0 },
  ideology: {},
  source: "congress_sync",
  source_system: "congress",
  source_id: "P1",
  jurisdiction_type: "federal",
  state_code: "VT",
  session_id: null,
  synced_at: "2026-07-01T00:00:00.000Z",
  raw_payload: null,
  raw_member: null,
};

const POL_ENTITY = {
  id: "pol-P1",
  slug: "test-pol",
  entity_type: "politician",
  label: "Test Politician",
  subtitle: "US Representative",
  image_url: null,
  metadata: { politicianId: "P1" },
  source_system: "fec_sync",
  source_id: "P1",
  source_url: null,
  synced_at: "2026-07-01T00:00:00.000Z",
};

const PAC_ENTITY = {
  ...POL_ENTITY,
  id: "pac-1",
  slug: "test-pac",
  entity_type: "pac",
  label: "Test PAC",
  subtitle: "Hybrid PAC",
  metadata: { pacType: "Hybrid PAC" },
};

const PAC_EDGE = {
  id: "e-1",
  source_entity_id: "pac-1",
  target_entity_id: "pol-P1",
  relationship_type: "contributed_to",
  relationship_direction: "directed",
  amount: 5000,
  transaction_count: 2,
  election_cycle: 2024,
  occurred_at: "2024-06-01T00:00:00.000Z",
  start_date: null,
  end_date: null,
  is_aggregate: false,
  confidence: 1,
  metadata: {},
  source_system: "fec_sync",
  source_id: "e-1",
  source_url: null,
  synced_at: "2026-07-01T00:00:00.000Z",
};

const BILL_ROW = {
  id: "hr-1",
  slug: "hr-1",
  number: "HR.1",
  title: "Test Act",
  summary: "A test bill.",
  jurisdiction: "Federal",
  country: "United States",
  state: null,
  chamber: "House",
  status: "Introduced",
  topic: "Energy",
  sponsor_id: "P1",
  sponsor_name: "Test Politician",
  committee_id: "cmte-9",
  committee_name: "Test Committee",
  latest_action: "Introduced",
  last_action_at: "Jul 1, 2026",
  introduced_at: "Jan 1, 2026",
  session: "119th Congress",
  chance_of_passing: 40,
  stats: { votes: 0, amendments: 0, cosponsors: 0, bipartisanScore: 0 },
  related_bill_ids: [],
  source: "congress_sync",
  source_system: "congress",
  source_id: "hr-1",
  jurisdiction_type: "federal",
  state_code: null,
  session_id: null,
  synced_at: "2026-07-01T00:00:00.000Z",
};

function installFetchMock() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";

  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = new URL(String(input));
    const json = (payload) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      async json() { return payload; },
      async text() { return JSON.stringify(payload); },
    });

    if (url.pathname === "/rest/v1/politicians") {
      if ((url.searchParams.get("slug") || "").includes("test-pol")) return json([POLITICIAN_ROW]);
      return json([]);
    }
    if (url.pathname === "/rest/v1/sync_runs") return json([]);
    if (url.pathname === "/rest/v1/graph_entities") {
      if ((url.searchParams.get("slug") || "").includes("test-pol")) return json([POL_ENTITY]);
      const idFilter = url.searchParams.get("id") || "";
      if (idFilter.startsWith("in.")) {
        const wanted = [];
        if (idFilter.includes("pol-P1")) wanted.push(POL_ENTITY);
        if (idFilter.includes("pac-1")) wanted.push(PAC_ENTITY);
        return json(wanted);
      }
      if (idFilter === "eq.pac-1") return json([PAC_ENTITY]);
      return json([]);
    }
    if (url.pathname === "/rest/v1/graph_edges") {
      const idFilter = url.searchParams.get("id") || "";
      if (idFilter === "eq.e-1") return json([PAC_EDGE]);
      if (idFilter.startsWith("eq.")) return json([]);
      return json([PAC_EDGE]);
    }
    if (url.pathname === "/rest/v1/funding_source_records") {
      return json([{ edge_id: "e-1", id: "r-1" }, { edge_id: "e-1", id: "r-2" }]);
    }
    if (url.pathname === "/rest/v1/committee_members") {
      return json([{ committee_id: "cmte-9", role: "member" }]);
    }
    if (url.pathname === "/rest/v1/committees") {
      return json([{ id: "cmte-9", slug: "test-committee", name: "Test Committee", chamber: "House" }]);
    }
    if (url.pathname === "/rest/v1/bills") {
      return json([BILL_ROW]);
    }
    if (url.pathname === "/rest/v1/vote_positions" || url.pathname === "/rest/v1/votes") {
      return json([]);
    }
    return json([]);
  };

  return () => {
    global.fetch = originalFetch;
  };
}

test("funding-graph route returns a source-backed graph with money and legislative sides", async () => {
  const restore = installFetchMock();
  try {
    const response = await fundingGraphRoute.GET(
      new Request("http://localhost/api/politicians/test-pol/funding-graph"),
      { params: Promise.resolve({ slug: "test-pol" }) },
    );
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.centerNodeId, "pol-P1");
    assert.equal(body.politician.name, "Test Politician");

    const nodeIds = body.nodes.map((node) => node.id);
    assert.ok(nodeIds.includes("pol-P1"), "politician node present");
    assert.ok(nodeIds.includes("pac-1"), "pac node present");
    assert.ok(nodeIds.includes("cmte-cmte-9"), "committee node present");
    assert.ok(nodeIds.includes("bill-hr-1"), "sponsored bill node present");

    const pacEdge = body.edges.find((edge) => edge.id === "e-1");
    assert.ok(pacEdge, "financial edge present");
    assert.equal(pacEdge.data.amount, 5000);
    assert.equal(pacEdge.data.sourceCount, 2, "edge carries its source-record count");

    assert.equal(body.totals.pacContributions, 5000);
    assert.deepEqual(body.availableFilters.cycles, [2024]);
    assert.equal(body.containsDemoData, false);
    assert.equal(body.truncated, false);
  } finally {
    restore();
  }
});

test("funding-graph route rejects invalid query parameters", async () => {
  const restore = installFetchMock();
  try {
    const response = await fundingGraphRoute.GET(
      new Request("http://localhost/api/politicians/test-pol/funding-graph?nodeTypes=bogus"),
      { params: Promise.resolve({ slug: "test-pol" }) },
    );
    assert.equal(response.status, 400);
  } finally {
    restore();
  }
});

test("funding-graph route hides legislative side when showLegislative=false", async () => {
  const restore = installFetchMock();
  try {
    const response = await fundingGraphRoute.GET(
      new Request("http://localhost/api/politicians/test-pol/funding-graph?showLegislative=false"),
      { params: Promise.resolve({ slug: "test-pol" }) },
    );
    const body = await response.json();
    const nodeIds = body.nodes.map((node) => node.id);
    assert.ok(!nodeIds.includes("cmte-cmte-9"));
    assert.ok(!nodeIds.includes("bill-hr-1"));
    assert.ok(nodeIds.includes("pac-1"), "money side remains");
  } finally {
    restore();
  }
});

test("neighbors route returns depth-1 expansion excluding already-visible ids", async () => {
  const restore = installFetchMock();
  try {
    const response = await neighborsRoute.GET(
      new Request("http://localhost/api/graph/entities/pac-1/neighbors?exclude=pol-P1"),
      { params: Promise.resolve({ entityId: "pac-1" }) },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.entity.id, "pac-1");
    // The only neighbor (pol-P1) is excluded, so no new neighbors arrive.
    assert.deepEqual(body.neighbors, []);
  } finally {
    restore();
  }
});

test("edge records route paginates underlying source records", async () => {
  const restore = installFetchMock();
  try {
    const response = await recordsRoute.GET(
      new Request("http://localhost/api/graph/edges/e-1/records?page=1&pageSize=10"),
      { params: Promise.resolve({ edgeId: "e-1" }) },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.edge.id, "e-1");
    assert.equal(body.records.length, 2);
    assert.equal(body.page, 1);
  } finally {
    restore();
  }
});
