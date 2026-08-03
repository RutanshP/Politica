const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const {
  buildAmendmentLinks,
  parseAmendmentSponsor,
  parseFederalBillId,
  parseRollCallNumber,
} = jiti("@/lib/server/amendment-link-sync");

// Verbatim from /bill/119/hr/8800/amendments.
const GROTHMAN = {
  congress: 119,
  type: "HAMDT",
  number: "266",
  description: "An amendment numbered 316 printed in Part A of House Report 119-755 to require the Secretary of Defense to submit a report detailing options for reducing the number of civilians employed by the Department of Defense by 200,000.",
  url: "https://api.congress.gov/v3/amendment/119/hamdt/266?format=json",
  latestAction: {
    actionDate: "2026-07-22",
    text: "On agreeing to the Grothman amendment (A025) Failed by recorded vote: 175 - 254 (Roll no. 276).",
  },
};

test("parseRollCallNumber finds the roll number that joins an amendment to its vote", () => {
  assert.equal(parseRollCallNumber(GROTHMAN.latestAction.text), "276");
  assert.equal(parseRollCallNumber("On agreeing to the amendment Agreed to by voice vote."), null);
  assert.equal(parseRollCallNumber(null), null);
});

test("parseAmendmentSponsor reads the sponsor the list endpoint omits", () => {
  assert.equal(parseAmendmentSponsor(GROTHMAN.latestAction.text), "Grothman");
  // Phrasing without a name must not produce one.
  assert.equal(parseAmendmentSponsor("On agreeing to the amendment Agreed to by recorded vote."), null);
  assert.equal(parseAmendmentSponsor(undefined), null);
});

test("buildAmendmentLinks keys an amendment by its roll call", () => {
  const links = buildAmendmentLinks([GROTHMAN]);
  const link = links.get("276");

  assert.equal(link.amendmentNumber, "H.Amdt. 266");
  assert.equal(link.sponsor, "Grothman");
  assert.ok(link.description.startsWith("An amendment numbered 316"));
  // The public page, not the api endpoint -- the text is what the reader wants.
  assert.equal(link.url, "https://www.congress.gov/amendment/119/hamdt/266");
});

test("buildAmendmentLinks skips amendments that never got a roll call", () => {
  // Voice-voted, withdrawn or ruled out of order: 6 of H.R. 8800's 25 amendments.
  const links = buildAmendmentLinks([
    GROTHMAN,
    { type: "HAMDT", number: "300", description: "x", latestAction: { text: "On agreeing to the amendment Agreed to by voice vote." } },
    { type: "HAMDT", number: "301", description: "y" },
  ]);

  assert.equal(links.size, 1);
  assert.ok(links.has("276"));
});

test("buildAmendmentLinks labels a Senate amendment with its own prefix", () => {
  const links = buildAmendmentLinks([
    { type: "SAMDT", number: "12", description: "z", latestAction: { text: "Amendment agreed to (Roll no. 40)." } },
  ]);

  assert.equal(links.get("40").amendmentNumber, "S.Amdt. 12");
});

test("parseFederalBillId splits a stored bill id into congress.gov path segments", () => {
  assert.deepEqual(parseFederalBillId("hr-8800", "119"), { congress: "119", billType: "hr", billNumber: "8800" });
  assert.deepEqual(parseFederalBillId("s-5123", "119"), { congress: "119", billType: "s", billNumber: "5123" });
  // A state id must not be sent to congress.gov.
  assert.equal(parseFederalBillId("ocd-bill/abc-123", "119"), null);
});
