const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { buildTenure, congressStartYear, describeReelectionFiling } = jiti("@/lib/tenure");

// Nancy Pelosi, abbreviated: 20 straight House terms, the 119th still open.
const PELOSI_TERMS = [
  { chamber: "House of Representatives", congress: 100, startYear: 1987, endYear: 1989, district: 5, stateCode: "CA", memberType: "Representative" },
  { chamber: "House of Representatives", congress: 101, startYear: 1989, endYear: 1991, district: 5, stateCode: "CA", memberType: "Representative" },
  { chamber: "House of Representatives", congress: 118, startYear: 2023, endYear: 2025, district: 11, stateCode: "CA", memberType: "Representative" },
  { chamber: "House of Representatives", congress: 119, startYear: 2025, district: 11, stateCode: "CA", memberType: "Representative" },
];

// Adam Schiff, abbreviated: House first, then the Senate mid-118th, then a full term.
const SCHIFF_TERMS = [
  { chamber: "House of Representatives", congress: 107, startYear: 2001, endYear: 2003, district: 27, stateCode: "CA", memberType: "Representative" },
  { chamber: "House of Representatives", congress: 118, startYear: 2023, endYear: 2024, district: 28, stateCode: "CA", memberType: "Representative" },
  { chamber: "Senate", congress: 118, startYear: 2024, endYear: 2025, stateCode: "CA", memberType: "Senator" },
  { chamber: "Senate", congress: 119, startYear: 2025, stateCode: "CA", memberType: "Senator" },
];

test("congressStartYear maps a Congress to the year it convened", () => {
  assert.equal(congressStartYear(1), 1789);
  assert.equal(congressStartYear(119), 2025);
  assert.equal(congressStartYear(118), 2023);
});

test("buildTenure treats the term without an end year as the one in progress", () => {
  const tenure = buildTenure(PELOSI_TERMS, 2026);

  assert.equal(tenure.currentTerm?.congress, 119);
  assert.equal(tenure.currentTerm?.isCurrent, true);
  assert.equal(tenure.terms.filter((term) => term.isCurrent).length, 1);
});

test("buildTenure projects a House term to the end of its Congress", () => {
  const tenure = buildTenure(PELOSI_TERMS, 2026);

  // The 119th convened in 2025 and runs two years, so the term ends January 2027 -- which puts
  // the seat on the ballot in November 2026.
  assert.equal(tenure.termEndsYear, 2027);
  assert.equal(tenure.nextElectionYear, 2026);
});

test("buildTenure gives a Senate term six years, not two", () => {
  const tenure = buildTenure(SCHIFF_TERMS, 2026);

  assert.equal(tenure.currentTerm?.chamber, "Senate");
  assert.equal(tenure.termEndsYear, 2031);
  assert.equal(tenure.nextElectionYear, 2030);
});

test("buildTenure counts terms per chamber and notices a chamber switch", () => {
  const schiff = buildTenure(SCHIFF_TERMS, 2026);
  assert.deepEqual(schiff.termsByChamber, { House: 2, Senate: 2 });
  assert.equal(schiff.switchedChambers, true);
  assert.equal(schiff.firstSwornYear, 2001);

  const pelosi = buildTenure(PELOSI_TERMS, 2026);
  assert.deepEqual(pelosi.termsByChamber, { House: 4, Senate: 0 });
  assert.equal(pelosi.switchedChambers, false);
});

test("buildTenure counts the current term up to the year asked about", () => {
  // 1987-1989, 1989-1991, 2023-2025 = 6 closed years, plus 2025 -> 2026 in progress.
  assert.equal(buildTenure(PELOSI_TERMS, 2026).yearsServed, 7);
  assert.equal(buildTenure(PELOSI_TERMS, 2025).yearsServed, 6);
});

test("buildTenure reads past elections off the start of each completed term", () => {
  const tenure = buildTenure(PELOSI_TERMS, 2026);

  // Newest first, and the term in progress is excluded -- that election is the current mandate.
  assert.deepEqual(tenure.previousElectionYears, [2022, 1988, 1986]);
});

test("buildTenure survives a member with no usable terms", () => {
  for (const input of [undefined, [], [{ chamber: "House of Representatives" }]]) {
    const tenure = buildTenure(input, 2026);
    assert.equal(tenure.terms.length, 0);
    assert.equal(tenure.yearsServed, 0);
    assert.equal(tenure.currentTerm, undefined);
    assert.equal(tenure.nextElectionYear, undefined);
    assert.deepEqual(tenure.previousElectionYears, []);
  }
});

test("buildTenure handles a former member whose terms are all closed", () => {
  const tenure = buildTenure(
    [{ chamber: "House of Representatives", congress: 117, startYear: 2021, endYear: 2023, district: 3, stateCode: "TX", memberType: "Representative" }],
    2026,
  );

  assert.equal(tenure.currentTerm, undefined);
  assert.equal(tenure.nextElectionYear, undefined);
  assert.equal(tenure.yearsServed, 2);
});

test("describeReelectionFiling does not read a missing filing as retirement", () => {
  const notFiled = describeReelectionFiling("not-filed", 2026);
  assert.match(notFiled.label, /No 2026 filing/);
  assert.match(notFiled.detail, /not a declaration of retirement/i);

  assert.match(describeReelectionFiling("filed", 2026).label, /Filed for 2026/);
  assert.equal(describeReelectionFiling("unknown").tone, "slate");
});

test("describeReelectionFiling separates an inactive filing from never filing", () => {
  // FEC flags a member who is not seeking reelection as inactive rather than deleting the
  // candidacy, so this is the strongest retirement signal available -- and it is not the same
  // statement as "never filed".
  const inactive = describeReelectionFiling("inactive", 2026);
  assert.match(inactive.label, /2026 filing inactive/);
  assert.match(inactive.detail, /not seeking reelection/i);
  assert.equal(inactive.tone, "rose");

  const none = describeReelectionFiling("not-filed", 2026);
  assert.match(none.label, /No 2026 filing/);
  assert.notEqual(none.tone, inactive.tone);
});

test("describeReelectionFiling says nothing either way for an unsynced cycle", () => {
  // A senator next up in 2030 has no 2030 rows to be absent from; silence is not retirement.
  const unknown = describeReelectionFiling("unknown", 2030);
  assert.match(unknown.label, /not known/i);
  assert.match(unknown.detail, /does not cover this cycle/i);
  assert.doesNotMatch(unknown.detail, /retir/i);
});
