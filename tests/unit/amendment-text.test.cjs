const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { cleanAmendmentText, amendmentSummaryKey, summarySimilarity, matchRulesRow } =
  jiti("@/lib/adapters/amendment-text");

test("cleanAmendmentText drops the drafting path the PDFs print", () => {
  // Generated from the House XML drafting system, which stamps the author's working path first.
  const cleaned = cleanAmendmentText([
    "G:\\M\\19\\HARRIG\\HARRIG_085.XML",
    "AMENDMENT TO RULES COMMITTEE PRINT",
    "OFFERED BY MR. HARRIGAN OF NORTH",
  ].join("\n"));

  assert.doesNotMatch(cleaned, /HARRIG_085/);
  assert.match(cleaned, /^AMENDMENT TO RULES COMMITTEE PRINT/);
});

test("cleanAmendmentText unglues the marginal line number from the text", () => {
  // The number shares a baseline with the text, so rebuilding the row joins them: "1SEC. 28ll."
  assert.equal(cleanAmendmentText("1SEC. 28ll. PROHIBITION ON USE"), "SEC. 28ll. PROHIBITION ON USE");
  assert.equal(cleanAmendmentText("12(a) Not later than 180 days"), "(a) Not later than 180 days");
});

test("cleanAmendmentText keeps a figure that genuinely starts a line", () => {
  // Only stripped where a capital or section marker follows, so real numbers survive.
  assert.equal(cleanAmendmentText("200,000 civilian employees"), "200,000 civilian employees");
});

test("cleanAmendmentText rejoins words hyphenated across lines", () => {
  assert.equal(
    cleanAmendmentText("At the end of subtitle C, add the fol-\nlowing new section:"),
    "At the end of subtitle C, add the following new section:",
  );
});

test("cleanAmendmentText leaves a real compound broken at a line end alone", () => {
  // The next line starting uppercase means the hyphen was not a break.
  assert.equal(cleanAmendmentText("a cost-\nEffective option"), "a cost-\nEffective option");
});

test("cleanAmendmentText removes page furniture", () => {
  const cleaned = cleanAmendmentText("SEC. 1. SHORT TITLE.\n2\n(Original Signature of Member)\n(a) In general");
  assert.doesNotMatch(cleaned, /Original Signature/);
  assert.match(cleaned, /SEC\. 1\. SHORT TITLE\.\n\(a\) In general/);
});

test("amendmentSummaryKey strips the congress.gov bookkeeping prefix", () => {
  const key = amendmentSummaryKey(
    "An amendment numbered 316 printed in Part A of House Report 119-755 to require the Secretary of Defense to submit a report.",
  );
  assert.doesNotMatch(key, /printed in part a/);
  assert.match(key, /^require the secretary of defense/);
});

test("summarySimilarity matches the same amendment stated by two sources", () => {
  // The Rules row and the congress.gov description are the same sentence with different prefixes.
  const rules = "Requires the Secretary of Defense to submit a report detailing options for reducing the number of civilians employed by the Department of Defense by 200,000.";
  const congress = "An amendment numbered 316 printed in Part A of House Report 119-755 to require the Secretary of Defense to submit a report detailing options for reducing the number of civilians employed by the Department of Defense by 200,000.";

  assert.ok(summarySimilarity(rules, congress) > 0.85, "same amendment should score high");
  assert.ok(summarySimilarity(rules, "Prohibits funds for automated speed enforcement cameras.") < 0.3);
});

test("matchRulesRow picks the sponsor's amendment, not another with similar wording", () => {
  const rows = [
    { sponsor: "Vargas (CA)", summary: "Requires the Secretary of Defense to submit a report on housing.", pdfUrl: "https://x/vargas.pdf" },
    { sponsor: "Grothman (WI)", summary: "Requires the Secretary of Defense to submit a report detailing options for reducing the number of civilians employed by the Department of Defense by 200,000.", pdfUrl: "https://x/grothman.pdf" },
  ];

  const hit = matchRulesRow(rows, {
    sponsor: "Grothman",
    summary: "An amendment numbered 316 printed in Part A of House Report 119-755 to require the Secretary of Defense to submit a report detailing options for reducing the number of civilians employed by the Department of Defense by 200,000.",
  });

  assert.equal(hit.pdfUrl, "https://x/grothman.pdf");
});

test("matchRulesRow returns nothing when no row is close enough", () => {
  const rows = [{ sponsor: "Vargas (CA)", summary: "Prohibits speed cameras.", pdfUrl: "https://x/v.pdf" }];
  assert.equal(matchRulesRow(rows, { sponsor: "Grothman", summary: "Reduces civilian employment by 200,000." }), undefined);
});

test("splitAmendmentText separates the instruction from the body", () => {
  const { splitAmendmentText } = jiti("@/lib/bill-versions");
  const split = splitAmendmentText([
    "AMENDMENT TO RULES COMM. PRINT 119-33",
    "OFFERED BY MR. GROTHMAN OF WISCONSIN",
    "At the end of subtitle A of title XI, insert the following new section:",
    "SEC. __. REPORT ON REDUCING CIVILIAN EMPLOYMENT.",
  ].join("\n"));

  // The instruction is the sentence saying where the change lands.
  assert.equal(split.instruction, "At the end of subtitle A of title XI, insert the following new section:");
  assert.match(split.body, /^SEC\. __\./);
});

test("splitAmendmentText returns the whole document when no instruction is recognisable", () => {
  const { splitAmendmentText } = jiti("@/lib/bill-versions");
  const split = splitAmendmentText("SOME UNUSUAL PHRASING\nnot matching any known form");

  assert.equal(split.instruction, undefined);
  assert.match(split.body, /SOME UNUSUAL PHRASING/);
});
