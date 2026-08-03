const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { dedupeBillActions } = jiti("@/lib/normalizers/legislation");

function action(date, label, detail, type = "milestone") {
  return { date, label, detail, type };
}

test("dedupeBillActions collapses an action filed under two stage labels", () => {
  // Verbatim from H.R. 6644: Congress.gov files each of these twice.
  const result = dedupeBillActions([
    action("Jun 28, 2026", "Floor", "Presented to President.", "executive"),
    action("Jun 28, 2026", "President", "Presented to President.", "executive"),
    action("Jul 10, 2026", "President", "Became Public Law No: 119-101."),
    action("Jul 10, 2026", "BecameLaw", "Became Public Law No: 119-101."),
  ]);

  assert.equal(result.length, 2);
  // The more specific stage label survives.
  assert.equal(result[0].label, "President");
  assert.equal(result[0].detail, "Presented to President.");
  assert.equal(result[1].label, "BecameLaw");
  assert.equal(result[1].detail, "Became Public Law No: 119-101.");
});

test("dedupeBillActions collapses a restatement carrying a stage prefix", () => {
  const result = dedupeBillActions([
    action("Jun 22, 2026", "ResolvingDifferences", "On motion that the House suspend the rules and agree to the Senate amendment Agreed to by the Yeas and Nays: 358 - 32.", "floor"),
    action("Jun 22, 2026", "NotUsed", "Resolving differences -- House actions: On motion that the House suspend the rules and agree to the Senate amendment Agreed to by the Yeas and Nays: 358 - 32.", "floor"),
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].label, "ResolvingDifferences");
  // The bare action text is kept, not the prefixed restatement.
  assert.ok(!result[0].detail.startsWith("Resolving differences"));
});

test("dedupeBillActions collapses the 'Passed/agreed to in' restatement", () => {
  const result = dedupeBillActions([
    action("Feb 8, 2026", "Floor", "On motion to suspend the rules and pass the bill, as amended Agreed to by the Yeas and Nays: 390 - 9 (Roll no. 57).", "floor"),
    action("Feb 8, 2026", "Floor", "Passed/agreed to in House: On motion to suspend the rules and pass the bill, as amended Agreed to by the Yeas and Nays: 390 - 9 (Roll no. 57).", "floor"),
  ]);

  assert.equal(result.length, 1);
  assert.ok(!result[0].detail.startsWith("Passed/agreed to"));
});

test("dedupeBillActions keeps the earliest position for a collapsed action", () => {
  const result = dedupeBillActions([
    action("Jan 14, 2026", "Discharge", "Committee on Veterans' Affairs discharged.", "committee"),
    action("Jan 14, 2026", "Committee", "Committee on Veterans' Affairs discharged.", "committee"),
    action("Jan 14, 2026", "Committee", "Reported (Amended) by the Committee on Financial Services.", "committee"),
  ]);

  assert.equal(result.length, 2);
  // Discharge wins the label but stays where the pair first appeared, ahead of the report.
  assert.equal(result[0].label, "Discharge");
  assert.equal(result[1].detail, "Reported (Amended) by the Committee on Financial Services.");
});

test("dedupeBillActions keeps genuinely distinct actions on the same day", () => {
  // Enactment without a signature is two real events, not a duplicate: the bill became law and
  // was sent to the Archivist unsigned.
  const result = dedupeBillActions([
    action("Jul 10, 2026", "BecameLaw", "Became Public Law No: 119-101."),
    action("Jul 10, 2026", "President", "Sent to Archivist of the United States unsigned.", "executive"),
  ]);

  assert.equal(result.length, 2);
});

test("dedupeBillActions leaves a repeated action on different dates alone", () => {
  const result = dedupeBillActions([
    action("Mar 3, 2026", "Floor", "Motion to proceed to measure considered in Senate."),
    action("Mar 2, 2026", "Floor", "Motion to proceed to measure considered in Senate."),
  ]);

  assert.equal(result.length, 2);
});

test("dedupeBillActions ignores whitespace and case differences", () => {
  const result = dedupeBillActions([
    action("Jun 28, 2026", "Floor", "Presented  to   President."),
    action("Jun 28, 2026", "President", "presented to president."),
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].label, "President");
});

test("dedupeBillActions handles an empty list", () => {
  assert.deepEqual(dedupeBillActions([]), []);
});

test("createBillActionIndex will not re-append an action that differs only by a CR citation", () => {
  // The append writers keyed on the raw text, so a citation-suffixed copy of an action already
  // stored looked new and landed beside it -- S.5123 ended up with three copies of one action.
  const { createBillActionIndex } = jiti("@/lib/normalizers/legislation");
  const index = createBillActionIndex();
  index.add("s-5123", action("Jul 22, 2026", "Floor", "Introduced in the Senate, read twice, considered, read the third time, and passed without amendment by Unanimous Consent.", "floor"));

  assert.equal(
    index.has("s-5123", action("Jul 22, 2026", "Floor", "Introduced in the Senate, read twice, considered, read the third time, and passed without amendment by Unanimous Consent. (consideration: CR S4273-4274; text: CR S4273-4274)", "floor")),
    true,
  );
});

test("createBillActionIndex still admits the same motion on a later day", () => {
  // The date is compared exactly, which is safe now that formatDisplayDate pins the zone. A motion
  // considered on two consecutive days is two real actions, not a duplicate.
  const { createBillActionIndex } = jiti("@/lib/normalizers/legislation");
  const index = createBillActionIndex();
  index.add("s-1", action("Mar 2, 2026", "Floor", "Motion to proceed to measure considered in Senate.", "floor"));

  assert.equal(
    index.has("s-1", action("Mar 3, 2026", "Floor", "Motion to proceed to measure considered in Senate.", "floor")),
    false,
  );
});

test("dedupeBillActions strips the Congressional Record citation before comparing", () => {
  const result = dedupeBillActions([
    action("Jul 22, 2026", "Floor", "Introduced in the Senate, read twice, considered, read the third time, and passed without amendment by Unanimous Consent. (consideration: CR S4273-4274; text: CR S4273-4274)", "floor"),
    action("Jul 22, 2026", "Floor", "Passed/agreed to in Senate: Introduced in the Senate, read twice, considered, read the third time, and passed without amendment by Unanimous Consent.", "floor"),
    action("Jul 22, 2026", "Floor", "Introduced in the Senate, read twice, considered, read the third time, and passed without amendment by Unanimous Consent.", "floor"),
  ]);

  assert.equal(result.length, 1);
  assert.ok(!result[0].detail.includes("consideration:"));
  assert.ok(!result[0].detail.startsWith("Passed/agreed to"));
});

test("dedupeBillActions leaves a genuine repeat on another date alone", () => {
  // "Committee Hearings Held." really does recur. The one-day-apart copies in the stored data came
  // from the timezone bug, so they are cleaned out by 025 rather than masked here -- collapsing on
  // text alone would hide real events.
  const result = dedupeBillActions([
    action("Mar 3, 2026", "Committee", "Committee Hearings Held.", "committee"),
    action("May 5, 2026", "Committee", "Committee Hearings Held.", "committee"),
  ]);

  assert.equal(result.length, 2);
});

test("sortBillActionsRecentFirst puts the newest action at the top", () => {
  const { sortBillActionsRecentFirst } = jiti("@/lib/normalizers/legislation");
  const sorted = sortBillActionsRecentFirst([
    action("Jul 22, 2026", "IntroReferral", "Introduced in Senate"),
    action("Jul 22, 2026", "Floor", "Passed the Senate.", "floor"),
    action("Jul 30, 2026", "Floor", "Message on Senate action sent to the House.", "floor"),
  ]);

  assert.deepEqual(sorted.map((item) => item.detail), [
    "Message on Senate action sent to the House.",
    // Within one date the later action still reads above the earlier one.
    "Passed the Senate.",
    "Introduced in Senate",
  ]);
});
