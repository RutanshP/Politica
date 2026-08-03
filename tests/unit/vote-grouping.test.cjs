const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { formatBillNumber, groupVotesByBill, summarizePositions } = jiti("@/lib/vote-grouping");

function vote(id, billId, billNumber, title, result, dateLabel, position) {
  return {
    id,
    billId,
    billNumber,
    title,
    chamber: "House",
    dateLabel,
    result,
    yea: 0,
    nay: 0,
    present: 0,
    notVoting: 0,
    positions: position ? [{ politicianId: "p1", name: "M", party: "D", state: "CA", vote: position }] : [],
  };
}

test("formatBillNumber reconciles the spellings the two feeds use", () => {
  // Both appeared a row apart on one member's page.
  assert.equal(formatBillNumber("H R 8800"), "HR 8800");
  assert.equal(formatBillNumber("HR.8884"), "HR 8884");
  assert.equal(formatBillNumber("S.5123"), "S 5123");
  assert.equal(formatBillNumber("hr 1"), "HR 1");
});

test("formatBillNumber leaves something it cannot parse alone", () => {
  assert.equal(formatBillNumber("Motion to Recommit"), "Motion to Recommit");
  assert.equal(formatBillNumber(""), "");
});

test("groupVotesByBill collapses every roll call on one measure into a single entry", () => {
  // Verbatim from H.R. 8800: four amendments, a recommit and passage, all on one bill.
  const groups = groupVotesByBill([
    vote("r-273", "hr-8800", "H R 8800", "On Agreeing to the Amendment", "Agreed to", "22-Jul-2026", "Yea"),
    vote("r-274", "hr-8800", "H R 8800", "On Agreeing to the Amendment", "Failed", "22-Jul-2026", "Yea"),
    vote("r-276", "hr-8800", "H R 8800", "On Agreeing to the Amendment", "Failed", "22-Jul-2026", "Nay"),
    vote("r-278", "hr-8800", "H R 8800", "On Passage", "Passed", "22-Jul-2026", "Yea"),
    vote("r-283", "hr-8884", "HR.8884", "Removing Barriers to Work for Disabled Americans Act", "Passed", "23-Jul-2026", "Yea"),
  ]);

  assert.equal(groups.length, 2);
  // Most recent measure first.
  assert.equal(groups[0].billNumber, "HR 8884");
  assert.equal(groups[1].billNumber, "HR 8800");
  assert.equal(groups[1].votes.length, 4);
  assert.deepEqual(
    { Yea: groups[1].counts.Yea, Nay: groups[1].counts.Nay },
    { Yea: 3, Nay: 1 },
  );
});

test("groupVotesByBill takes the measure title from a roll call that is not a motion", () => {
  const [group] = groupVotesByBill([
    vote("a", "hr-1", "H R 1", "On Agreeing to the Amendment", "Failed", "22-Jul-2026", "Nay"),
    vote("b", "hr-1", "H R 1", "Lunar Landing Day Act", "Passed", "22-Jul-2026", "Yea"),
  ]);

  assert.equal(group.billTitle, "Lunar Landing Day Act");
});

test("groupVotesByBill keeps unlinked roll calls apart", () => {
  // Without a bill id there is nothing to prove two state roll calls are the same measure, and
  // the printed number can collide across states.
  const groups = groupVotesByBill([
    vote("s1", undefined, "HB 1", "On Passage", "Passed", "22-Jul-2026", "Yea"),
    vote("s2", undefined, "HB 1", "On Passage", "Passed", "21-Jul-2026", "Nay"),
  ]);

  assert.equal(groups.length, 2);
});

test("groupVotesByBill orders roll calls inside a measure most recent first", () => {
  const [group] = groupVotesByBill([
    vote("old", "hr-2", "H R 2", "On Agreeing to the Amendment", "Failed", "21-Jul-2026", "Nay"),
    vote("new", "hr-2", "H R 2", "On Passage", "Passed", "22-Jul-2026", "Yea"),
  ]);

  assert.deepEqual(group.votes.map((item) => item.id), ["new", "old"]);
});

test("summarizePositions reads in a fixed order", () => {
  assert.equal(
    summarizePositions({ Yea: 3, Nay: 1, Present: 0, "Not Voting": 2, Unknown: 0 }),
    "3 Yea · 1 Nay · 2 Not Voting",
  );
});

test("groupVotesByBill orders same-day roll calls by roll number, newest first", () => {
  // Fifteen roll calls can share one date, so the date alone left them in query order and there
  // was no answer to which was the newer.
  const rows = [
    { ...vote("house-119-2-0255", "hr-8800", "H R 8800", "On Agreeing to the Amendment", "Failed", "21-Jul-2026", "Nay"), canonicalId: "house-roll-119-2-255" },
    { ...vote("house-119-2-0278", "hr-8800", "H R 8800", "On Passage", "Passed", "21-Jul-2026", "Nay"), canonicalId: "house-roll-119-2-278" },
    { ...vote("house-119-2-0260", "hr-8800", "H R 8800", "On Agreeing to the Amendment", "Agreed to", "21-Jul-2026", "Nay"), canonicalId: "house-roll-119-2-260" },
  ];

  const [group] = groupVotesByBill(rows);
  assert.deepEqual(group.votes.map((item) => item.canonicalId), [
    "house-roll-119-2-278",
    "house-roll-119-2-260",
    "house-roll-119-2-255",
  ]);
});

test("voteQuestionOf prefers the motion over the substituted measure title", () => {
  const { voteQuestionOf } = jiti("@/lib/vote-grouping");
  // H.R. 7008: the sync replaced both roll calls' titles with the bill name, so the recommit and
  // the passage vote read identically. question keeps the motion.
  const recommit = { ...vote("a", "hr-7008", "HR.7008", "Stop Insider Trading Act", "Failed", "22-Jul-2026", "Yea"), question: "On Motion to Recommit" };
  assert.equal(voteQuestionOf(recommit), "On Motion to Recommit");
  // A legacy row with no question still reads as something.
  assert.equal(voteQuestionOf(vote("b", "hr-1", "HR.1", "On Passage", "Passed", "22-Jul-2026", "Yea")), "On Passage");
});

test("groupVotesByBill takes the measure title from the title that differs from the question", () => {
  const rows = [
    { ...vote("a", "hr-7008", "HR.7008", "Stop Insider Trading Act", "Failed", "22-Jul-2026", "Yea"), question: "On Motion to Recommit" },
    { ...vote("b", "hr-7008", "HR.7008", "Stop Insider Trading Act", "Passed", "22-Jul-2026", "Nay"), question: "On Passage" },
  ];

  const [group] = groupVotesByBill(rows);
  assert.equal(group.billTitle, "Stop Insider Trading Act");
  assert.deepEqual(group.votes.map((item) => item.question), ["On Motion to Recommit", "On Passage"]);
});
