const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { extractBillMentions, isQuarterlyReport, quarterLabel, congressForYear } = jiti("@/lib/lobbying/lda-text");
const { organizationKey, tidyOrganizationName } = jiti("@/lib/organization-names");

const mentions = (text) => [...extractBillMentions(text)].sort();

test("bill citations are read in the spellings filers use", () => {
  assert.deepEqual(mentions("Issues related to H.R. 4930 and S. 2677"), ["hr-4930", "s-2677"]);
  assert.deepEqual(mentions("HR 1, the One Big Beautiful Bill Act; HR8413"), ["hr-1", "hr-8413"]);
  assert.deepEqual(mentions("S.351, H.R.2145, H.R.4109"), ["hr-2145", "hr-4109", "s-351"]);
  assert.deepEqual(mentions("H. Res. 45; S.Res.12; H.J.Res. 7; S.J. Res. 3"), ["hjres-7", "hres-45", "sjres-3", "sres-12"]);
  assert.deepEqual(mentions("H.Con.Res. 14 and S. Con. Res. 2"), ["hconres-14", "sconres-2"]);
});

test("things that look like citations but are not are ignored", () => {
  assert.deepEqual(mentions("Implementation of 42 U.S.C. 1395 and U.S. 2025 trade policy"), []);
  assert.deepEqual(mentions("FY2026 appropriations; items 5 and 6; vs. 12"), []);
  assert.deepEqual(mentions("Section 1234-5 of the code"), []);
});

test("citations of another Congress's bills are dropped", () => {
  assert.deepEqual(mentions("H.R. 8413 (118th Congress) and H.R. 976"), ["hr-976"]);
  assert.deepEqual(mentions("S. 12, 118th Congress"), []);
  assert.deepEqual(mentions("S. 12 (119th Congress)"), ["s-12"]);
});

test("organization keys join differently punctuated filings of one organization", () => {
  assert.equal(organizationKey("Meta Platforms, Inc."), "meta-platforms");
  assert.equal(organizationKey("META PLATFORMS INC"), "meta-platforms");
  assert.equal(organizationKey("The Boeing Company"), "boeing");
  assert.equal(organizationKey("AT&T Services, Inc."), "at-and-t-services");
  assert.equal(organizationKey("Alphabet Inc. (formerly Google)"), "alphabet");
  assert.equal(organizationKey("Co"), "co");
  assert.equal(organizationKey(null), "");
});

test("all-caps names are title-cased with acronyms kept", () => {
  assert.equal(tidyOrganizationName("NATIONAL ASSOCIATION OF REALTORS"), "National Association of Realtors");
  assert.equal(tidyOrganizationName("PHARMACEUTICAL RESEARCH AND MANUFACTURERS OF AMERICA"), "Pharmaceutical Research and Manufacturers of America");
  assert.equal(tidyOrganizationName("AMAZON.COM SERVICES LLC"), "Amazon.com Services LLC");
  assert.equal(tidyOrganizationName("Meta Platforms, Inc."), "Meta Platforms, Inc.");
});

test("only quarterly reports carry a quarter's money", () => {
  assert.equal(isQuarterlyReport("Q2", "second_quarter"), true);
  assert.equal(isQuarterlyReport("2A", "second_quarter"), true);
  assert.equal(isQuarterlyReport("3T", "third_quarter"), true);
  assert.equal(isQuarterlyReport("RR", null), false);
  assert.equal(isQuarterlyReport("RA", "first_quarter"), false);
  assert.equal(quarterLabel(2026, "second_quarter"), "Q2 2026");
  assert.equal(congressForYear(2025), 119);
  assert.equal(congressForYear(2026), 119);
  assert.equal(congressForYear(2027), 120);
});
