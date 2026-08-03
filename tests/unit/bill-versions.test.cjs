const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { buildBillVersionEntries, resolveBillVersion, baseTextForVersion } = jiti("@/lib/bill-versions");

// Verbatim shape from H.R. 8800: two bill texts, amendments, a recommit and passage.
const BILL = {
  id: "hr-8800",
  versions: [
    { id: "hr-8800-text-1", label: "Reported in House", date: "Jun 14, 2026", sourceUrl: "https://x/rh.htm" },
    { id: "hr-8800-text-2", label: "Introduced in House", date: "May 12, 2026", sourceUrl: "https://x/ih.htm" },
  ],
};

function vote(id, title, date, extra = {}) {
  return {
    id, billId: "hr-8800", billNumber: "H R 8800", title,
    chamber: "House", dateLabel: date, result: "Failed",
    yea: 175, nay: 254, present: 0, notVoting: 3, positions: [], ...extra,
  };
}

const VOTES = [
  vote("r-276", "On Agreeing to the Amendment", "22-Jul-2026", {
    amendmentNumber: "H.Amdt. 266", amendmentSponsor: "Grothman",
    description: "Report on reducing DoD civilian employment by 200,000.",
    amendmentUrl: "https://www.congress.gov/amendment/119/hamdt/266",
  }),
  vote("r-275", "On Agreeing to the Amendment", "22-Jul-2026", {
    amendmentNumber: "H.Amdt. 261", amendmentSponsor: "Harrigan", result: "Agreed to",
  }),
  vote("r-278", "On Passage", "22-Jul-2026", { result: "Passed", yea: 216, nay: 212 }),
];

test("buildBillVersionEntries puts amendments and bill texts in one list, newest first", () => {
  const entries = buildBillVersionEntries(BILL, VOTES);

  // 2 amendments + 2 bill texts. Passage is not its own entry.
  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map((e) => e.label), [
    "H.Amdt. 266", "H.Amdt. 261", "Reported in House", "Introduced in House",
  ]);
});

test("buildBillVersionEntries carries the sponsor and what the amendment did", () => {
  const [first] = buildBillVersionEntries(BILL, VOTES);
  assert.equal(first.kind, "amendment");
  assert.equal(first.sponsor, "Grothman");
  assert.match(first.summary, /reducing DoD civilian employment/);
  assert.equal(first.result, "Failed");
  assert.deepEqual(first.tally, { yea: 175, nay: 254, present: 0, notVoting: 3 });
});

test("a passage vote attaches to the bill text it was taken on, not its own entry", () => {
  const entries = buildBillVersionEntries(BILL, VOTES);
  const reported = entries.find((e) => e.label === "Reported in House");

  // Passage on 22 Jul lands on the text reported 14 Jun, the one operative that day.
  assert.equal(reported.voteId, "r-278");
  assert.equal(reported.result, "Passed");
  assert.equal(entries.some((e) => e.label === "On Passage"), false);
});

test("resolveBillVersion prefers the requested id, then the vote, then the newest", () => {
  const entries = buildBillVersionEntries(BILL, VOTES);

  assert.equal(resolveBillVersion(entries, { versionId: "text-hr-8800-text-2" }).label, "Introduced in House");
  // A link from a member's vote lands on the amendment they voted on.
  assert.equal(resolveBillVersion(entries, { voteId: "r-275" }).label, "H.Amdt. 261");
  assert.equal(resolveBillVersion(entries).label, "H.Amdt. 266");
});

test("resolveBillVersion falls back rather than failing on a stale id", () => {
  // Version ids move when a bill re-syncs; a bookmark should still land on something readable.
  const entries = buildBillVersionEntries(BILL, VOTES);
  assert.equal(resolveBillVersion(entries, { versionId: "text-gone" }).label, "H.Amdt. 266");
});

test("baseTextForVersion gives an amendment the text it was proposed against", () => {
  const entries = buildBillVersionEntries(BILL, VOTES);
  const amendment = entries.find((e) => e.label === "H.Amdt. 266");
  const text = entries.find((e) => e.label === "Introduced in House");

  assert.equal(baseTextForVersion(entries, amendment).label, "Reported in House");
  // A bill text is its own base.
  assert.equal(baseTextForVersion(entries, text).label, "Introduced in House");
});

test("buildBillVersionEntries treats a pre-backfill amendment vote as an amendment", () => {
  // Rows synced before votes.amendment_number existed have only the motion to go on.
  const entries = buildBillVersionEntries(BILL, [
    vote("r-1", "On Agreeing to the Amendment", "21-Jul-2026"),
  ]);

  const amendment = entries.find((e) => e.kind === "amendment");
  assert.ok(amendment, "should still be listed as an amendment");
  assert.equal(amendment.label, "On Agreeing to the Amendment");
});

test("buildBillVersionEntries copes with a bill that has no versions or votes", () => {
  assert.deepEqual(buildBillVersionEntries({ id: "hr-1", versions: [] }, []), []);
});
