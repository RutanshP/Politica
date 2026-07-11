const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const {
  deriveCommitteeSector,
  normalizeCommitteeField,
  normalizePartyLabel,
  normalizeStateLabel,
  hasVotePerformanceStats,
  sortLabelsAlphabetically,
} = jiti("@/lib/utils");

test("normalizePartyLabel collapses short party labels into canonical names", () => {
  assert.equal(normalizePartyLabel("D"), "Democratic");
  assert.equal(normalizePartyLabel("R"), "Republican");
  assert.equal(normalizePartyLabel("Independent"), "Independent");
});

test("normalizeStateLabel expands postal abbreviations", () => {
  assert.equal(normalizeStateLabel("CA"), "California");
  assert.equal(normalizeStateLabel("Virginia"), "Virginia");
});

test("hasVotePerformanceStats distinguishes placeholders from real vote metrics", () => {
  assert.equal(hasVotePerformanceStats({
    votesWithParty: 0,
    votesAgainstParty: 0,
    attendance: 0,
  }), false);

  assert.equal(hasVotePerformanceStats({
    votesWithParty: 92,
    votesAgainstParty: 8,
    attendance: 99,
  }), true);
});

test("sortLabelsAlphabetically returns unique alphabetical labels", () => {
  assert.deepEqual(
    sortLabelsAlphabetically(["Virginia", "California", "Virginia", "Ohio"]),
    ["California", "Ohio", "Virginia"],
  );
});

test("deriveCommitteeSector infers sectors from committee text", () => {
  assert.equal(
    deriveCommitteeSector({
      name: "Committee on Agriculture",
      jurisdiction: "Food and farm programs",
    }),
    "Agriculture",
  );
});

test("normalizeCommitteeField replaces known placeholders with clearer fallback copy", () => {
  assert.equal(
    normalizeCommitteeField("Not available from configured sources", "Leadership has not been synced yet"),
    "Leadership has not been synced yet",
  );
});
