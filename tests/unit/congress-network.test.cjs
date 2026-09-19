const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { classifyCommittee, committeeOwner } = jiti("@/lib/graph/pac-classification");
const { layoutCongressNetwork } = jiti("@/lib/graph/congress-network-layout");
const { decodeNetwork, encodeNetwork } = jiti("@/lib/graph/congress-network-wire");
const { tidyCommitteeName } = jiti("@/lib/data/congress-network");

test("classifyCommittee drops joint fundraisers and sorts the rest by what they are", () => {
  assert.equal(classifyCommittee({ committee_type: "N", designation: "J" }), null);
  assert.equal(classifyCommittee({ committee_type: "H", designation: "P" }), "campaign");
  assert.equal(classifyCommittee({ committee_type: "Q", designation: "D" }), "leadership");
  assert.equal(classifyCommittee({ committee_type: "Y", designation: "U" }), "party");
  assert.equal(classifyCommittee({ committee_type: "Q", designation: "B", organization_type: "C" }), "corporate");
  assert.equal(classifyCommittee({ committee_type: "Q", designation: "B", organization_type: "L" }), "labor");
  assert.equal(classifyCommittee({ committee_type: "Q", designation: "B", organization_type: "T" }), "trade");
  assert.equal(classifyCommittee({ committee_type: "O", designation: "U" }), "super_pac");
  assert.equal(classifyCommittee({ committee_type: "Q", designation: "U" }), "ideological");
});

test("committeeOwner resolves a leadership PAC's sponsor to a bioguide id", () => {
  const byFec = new Map([["H0MO08133", "S001195"]]);
  assert.equal(committeeOwner({ sponsor_candidate_ids: ["H0MO08133"] }, "leadership", byFec), "S001195");
  assert.equal(committeeOwner({ sponsor_candidate_ids: ["H0MO08133"] }, "corporate", byFec), null);
  assert.equal(committeeOwner({ candidate_ids: ["UNKNOWN"] }, "campaign", byFec), null);
});

test("layoutCongressNetwork puts members who share donors closer than members who do not", () => {
  // Members 0 and 1 share committees 0-3; member 2 shares nothing with them.
  const edges = [
    0, 0, 1000, 0, 1, 1000,
    1, 0, 1000, 1, 1, 1000,
    2, 0, 1000, 2, 1, 1000,
    3, 0, 1000, 3, 1, 1000,
    4, 2, 1000, 5, 2, 1000, 6, 2, 1000, 7, 3, 1000, 4, 3, 1000, 5, 3, 1000,
  ];
  const layout = layoutCongressNetwork({ memberCount: 4, memberParty: ["D", "D", "R", "R"], committeeCount: 8, edges });
  const at = (index) => [layout.members[index * 2], layout.members[index * 2 + 1]];
  const distance = (a, b) => Math.hypot(at(a)[0] - at(b)[0], at(a)[1] - at(b)[1]);
  assert.ok(distance(0, 1) < distance(0, 2), `${distance(0, 1)} should be < ${distance(0, 2)}`);

  // A committee giving to one member sits near that member.
  const committee = 7;
  const [cx, cy] = [layout.committees[committee * 2], layout.committees[committee * 2 + 1]];
  assert.ok(Math.hypot(cx - at(3)[0], cy - at(3)[1]) < 0.2);

  // Oriented: Democrats (0, 1) left of Republicans (2, 3).
  assert.ok((at(0)[0] + at(1)[0]) / 2 < (at(2)[0] + at(3)[0]) / 2, "Democrats sit left of Republicans");

  // Deterministic.
  assert.deepEqual(layoutCongressNetwork({ memberCount: 4, memberParty: ["D", "D", "R", "R"], committeeCount: 8, edges }), layout);
});

test("the wire form round-trips committees", () => {
  const network = {
    cycle: 2026,
    members: [],
    committees: [
      { id: "C1", name: "A PAC", category: "corporate", owner: null, connectedOrg: null },
      { id: "C2", name: "B PAC", category: "leadership", owner: 3, connectedOrg: "Org" },
    ],
    edges: [],
    memberPositions: [],
    committeePositions: [],
    generatedAt: "x",
  };
  assert.deepEqual(decodeNetwork(encodeNetwork(network)), network);
});

test("tidyCommitteeName title-cases FEC's all-caps names and keeps acronyms", () => {
  assert.equal(tidyCommitteeName("AMERICAN BANKERS ASSOCIATION PAC (BANKPAC)"), "American Bankers Association PAC (BANKPAC)");
  assert.equal(tidyCommitteeName("Already Mixed Case"), "Already Mixed Case");
});

test("tidyCommitteeName keeps initials and PAC brands loud, and English words in title case", () => {
  assert.equal(tidyCommitteeName("DCCC"), "DCCC");
  assert.equal(tidyCommitteeName("JSTREETPAC"), "JSTREETPAC");
  assert.equal(tidyCommitteeName("COMMUNICATIONS WORKERS OF AMERICA - CWA - COPE"), "Communications Workers of America - CWA - COPE");
  assert.equal(tidyCommitteeName("THE BOEING COMPANY POLITICAL ACTION COMMITTEE"), "The Boeing Company Political Action Committee");
  assert.equal(tidyCommitteeName("OIL AND GAS PAC"), "Oil and Gas PAC");
});
