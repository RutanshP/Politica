const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { currentExecutives, currentTerm, displayName } = jiti("@/lib/adapters/executive");
const { buildFederalExecutiveRows, buildGovernorRows } = jiti("@/lib/server/executive-sync");

// Verbatim shape from unitedstates/congress-legislators executive.json.
const VANCE = {
  name: { first: "James David", nickname: "J.D.", last: "Vance", official_full: "J.D. Vance" },
  id: { bioguide: "V000137" },
  terms: [{ type: "viceprez", start: "2025-01-20", end: "2029-01-20", party: "Republican" }],
};
const FORMER = {
  name: { first: "Kamala", last: "Harris", official_full: "Kamala Harris" },
  id: { bioguide: "H001075" },
  terms: [{ type: "viceprez", start: "2021-01-20", end: "2025-01-20", party: "Democrat" }],
};

test("currentTerm compares date-only strings rather than parsing them", () => {
  /*
   * These are YYYY-MM-DD, so `new Date` would read them as UTC midnight and shift the boundary by
   * a timezone -- the same trap that produced 4,199 duplicate bill actions. On the changeover day
   * the incoming term is already in force and the outgoing one is not.
   */
  assert.ok(currentTerm(VANCE, "2025-01-20"), "term should be current on its first day");
  assert.equal(currentTerm(VANCE, "2025-01-19"), undefined, "not yet in office the day before");
  assert.equal(currentTerm(FORMER, "2025-01-20"), undefined, "term ending today is over");
  assert.ok(currentTerm(FORMER, "2024-06-01"), "was in office mid-term");
});

test("currentExecutives returns only who holds office today", () => {
  const current = currentExecutives([VANCE, FORMER], "2026-08-08");
  assert.equal(current.length, 1);
  assert.equal(current[0].office, "Vice President");
  assert.equal(displayName(current[0].record), "J.D. Vance");
});

test("currentExecutives ignores terms that are neither presidency nor vice presidency", () => {
  // The same dataset carries senate and house terms for people who later became President.
  const senator = { name: { official_full: "Someone" }, terms: [{ type: "sen", start: "2020-01-03", end: "2027-01-03" }] };
  assert.deepEqual(currentExecutives([senator], "2026-08-08"), []);
});

test("federal executive rows are namespaced so they cannot overwrite a legislative record", () => {
  /*
   * Vance holds a bioguide from the Senate and may already be a row in politicians. Writing the
   * vice presidency under that same id would replace his legislative record and its vote history.
   */
  const [row] = buildFederalExecutiveRows([VANCE], "2026-08-08");
  assert.equal(row.id, "exec-V000137");
  assert.notEqual(row.id, "V000137");
  assert.equal(row.branch, "executive");
  assert.equal(row.jurisdiction_type, "federal");
  assert.equal(row.title, "Vice President");
  assert.equal(row.party, "Republican");
});

test("buildGovernorRows takes the governor and leaves the other executive officers", () => {
  // The same OpenStates query returns lieutenant governors, attorneys general and secretaries of
  // state; only one of them is the governor.
  const rows = buildGovernorRows("tx", [
    { id: "ocd-person/1", name: "Greg Abbott", party: "Republican", current_role: { title: "Governor" } },
    { id: "ocd-person/2", name: "Dan Patrick", party: "Republican", current_role: { title: "Lt_Governor" } },
    { id: "ocd-person/3", name: "Ken Paxton", party: "Republican", current_role: { title: "Attorney General" } },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Greg Abbott");
  assert.equal(rows[0].title, "Governor");
  assert.equal(rows[0].branch, "executive");
  assert.equal(rows[0].jurisdiction_type, "state");
});

test("a governor row is keyed by state, so a new governor replaces the old one", () => {
  const [first] = buildGovernorRows("ny", [{ name: "Kathy Hochul", current_role: { title: "Governor" } }]);
  const [second] = buildGovernorRows("ny", [{ name: "Someone Else", current_role: { title: "Governor" } }]);

  assert.equal(first.id, "gov-ny");
  assert.equal(second.id, "gov-ny", "same key, so the upsert replaces rather than accumulating");
});

test("a state with no governor in the source yields no rows rather than a wrong one", () => {
  // OpenStates returns California's lieutenant governor, attorney general and secretary of state
  // but not its governor. A gap in the source must not become a mislabelled row.
  const rows = buildGovernorRows("ca", [
    { name: "Eleni Kounalakis", current_role: { title: "Lt_Governor" } },
    { name: "Rob Bonta", current_role: { title: "Attorney General" } },
  ]);

  assert.deepEqual(rows, []);
});
