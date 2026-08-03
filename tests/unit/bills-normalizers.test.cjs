const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const {
  chooseCongressBillTitle,
  deriveBillStatus,
  parseBillId,
  normalizeCongressBillListItem,
  mergeCongressBillDetail,
} = jiti("@/lib/normalizers/bills");

test("parseBillId parses normalized bill ids", () => {
  assert.deepEqual(parseBillId("hr-123"), {
    billType: "hr",
    billNumber: "123",
  });
});

test("parseBillId rejects invalid ids", () => {
  assert.equal(parseBillId("invalid"), null);
});

test("normalizeCongressBillListItem creates source metadata", () => {
  const bill = normalizeCongressBillListItem({
    type: "hr",
    number: "10",
    title: "Test Bill",
    originChamber: "House",
    latestAction: {
      text: "Passed House",
      actionDate: "2026-07-01",
    },
    policyArea: {
      name: "Technology",
    },
    sponsors: [{
      bioguideId: "A0001",
      fullName: "Rep. Ada Lovelace",
    }],
  });

  assert.equal(bill.id, "hr-10");
  assert.equal(bill.status, "Passed Chamber");
  assert.equal(bill.sourceMetadata?.sourceSystem, "congress");
});

test("mergeCongressBillDetail keeps the full action timeline and version metadata", () => {
  const seed = normalizeCongressBillListItem({
    congress: "119",
    type: "hr",
    number: "10",
    title: "Test Bill",
    originChamber: "House",
    latestAction: {
      text: "Passed House",
      actionDate: "2026-07-01",
    },
    sponsors: [{
      bioguideId: "A0001",
      fullName: "Rep. Ada Lovelace",
    }],
  });

  const merged = mergeCongressBillDetail(
    seed,
    {
      bill: {
        number: "10",
        type: "hr",
        introducedDate: "2026-01-05",
        latestAction: {
          text: "Signed by President",
          actionDate: "2026-07-04",
        },
        titles: [{ title: "Official Test Bill", titleType: "Official Title as Introduced" }],
        sponsors: [{ bioguideId: "A0001", fullName: "Rep. Ada Lovelace" }],
        policyArea: { name: "Technology" },
        committees: { count: 2 },
      },
    },
    {
      actions: [
        { actionDate: "2026-01-05", text: "Introduced in House", type: "Intro" },
        { actionDate: "2026-03-01", text: "Referred to committee", type: "Referral" },
        { actionDate: "2026-07-04", text: "Signed by President", type: "Signed" },
      ],
    },
    {
      textVersions: [
        {
          date: "2026-01-05",
          type: "Introduced in House",
          formats: [{ type: "Formatted Text", url: "https://example.com/text.txt" }],
        },
      ],
    },
  );

  assert.equal(merged.title, "Official Test Bill");
  assert.equal(merged.actions.length, 3);
  assert.equal(merged.actions[1].type, "committee");
  assert.equal(merged.versions[0].sourceUrl, "https://example.com/text.txt");
  assert.equal(merged.versions[0].formats[0].type, "Formatted Text");
});

test("mergeCongressBillDetail tolerates non-array title payloads", () => {
  const seed = normalizeCongressBillListItem({
    congress: "119",
    type: "hr",
    number: "134",
    title: "Seed Title",
    originChamber: "House",
  });

  const merged = mergeCongressBillDetail(
    seed,
    {
      bill: {
        number: "134",
        type: "hr",
        titles: {
          title: "Object-Shaped Official Title",
          titleType: "Official Title as Introduced",
        },
      },
    },
  );

  assert.equal(merged.title, "Object-Shaped Official Title");
});

test("chooseCongressBillTitle avoids generic bill-number-only titles", () => {
  const chosen = chooseCongressBillTitle(
    [
      { title: "HR 493", titleType: "Official Title as Introduced" },
    ],
    "HR 493",
    "<p><strong>Federal Adjustment of Income Rates Act or the FAIR Act</strong></p>",
  );

  assert.equal(chosen, "Federal Adjustment of Income Rates Act or the FAIR Act");
});

/*
 * H.R. 23 (119th): passed the House 243-140, then died on a cloture vote in the Senate. Reading
 * only the newest action reported "Introduced", because the cloture line matches no milestone.
 * Progress is cumulative, so the status is a maximum over the history.
 */
test("deriveBillStatus remembers a chamber passage after a later unrecognized action", () => {
  const actions = [
    "Introduced in House",
    "Referred to the Committee on Foreign Affairs, and in addition to the Committees on the Judiciary",
    "DEBATE - The House proceeded with one hour of debate on H.R. 23.",
    "Passed/agreed to in House: On passage Passed by the Yeas and Nays: 243 - 140, 1 Present (Roll no. 7).",
    "Received in the Senate. Read the first time. Placed on Senate Legislative Calendar under Read the First Time.",
    "Motion to proceed to consideration of measure made in Senate. (CR S307)",
  ];
  const latest =
    "Cloture on the motion to proceed to the measure not invoked in Senate by Yea-Nay Vote. 54 - 45. Record Vote Number: 22. (CR S410)";

  assert.equal(deriveBillStatus(actions, latest), "Passed Chamber");
});

test("deriveBillStatus matches the wording Congress.gov actually publishes", () => {
  // "Passed House" is not what the feed says; "Passed/agreed to in House" is.
  assert.equal(
    deriveBillStatus(["Passed/agreed to in House: On passage Passed by the Yeas and Nays: 243 - 140."]),
    "Passed Chamber",
  );
  assert.equal(
    deriveBillStatus(["Passed/agreed to in Senate: Passed Senate without amendment by Voice Vote."]),
    "Passed Chamber",
  );
});

test("deriveBillStatus keeps later milestones ahead of earlier ones", () => {
  const throughSigning = [
    "Introduced in House",
    "Referred to the Committee on Ways and Means.",
    "Passed/agreed to in House: On passage Passed by the Yeas and Nays.",
    "Presented to President.",
    "Became Public Law No: 119-1.",
  ];
  assert.equal(deriveBillStatus(throughSigning), "Signed");

  // Reaching the President is its own rung, not something a later action erases.
  assert.equal(
    deriveBillStatus(["Introduced in House", "Passed/agreed to in House: On passage.", "Presented to President."]),
    "Sent to President",
  );
});

test("deriveBillStatus treats a terminal failure as the present fate", () => {
  const failed = deriveBillStatus(
    ["Introduced in House", "Considered under suspension of the rules."],
    "Failed of passage/not agreed to in House: On motion to suspend the rules and pass the bill Failed by the Yeas and Nays: 200 - 220.",
  );
  assert.equal(failed, "Failed");

  // A failed motion to recommit or to table means the bill survived the attack, not that it died.
  assert.equal(
    deriveBillStatus(
      ["Introduced in House", "Passed/agreed to in House: On passage Passed by the Yeas and Nays."],
      "On motion to recommit Failed by the Yeas and Nays: 190 - 230.",
    ),
    "Passed Chamber",
  );
});

test("deriveBillStatus falls back to Introduced only when nothing was reached", () => {
  assert.equal(deriveBillStatus([]), "Introduced");
  assert.equal(deriveBillStatus(["Introduced in House"]), "Introduced");
  assert.equal(deriveBillStatus(["Referred to the Subcommittee on Health."]), "In Committee");
});

test("deriveBillStatus recognizes defeats that never use the word passage", () => {
  // A suspension vote needs 2/3; losing it defeats the measure.
  assert.equal(
    deriveBillStatus(
      ["Introduced in House"],
      "On motion to suspend the rules and pass the bill Failed by the Yeas and Nays: (2/3 required): 198 - 218 (Roll no. 221).",
    ),
    "Failed",
  );
  // A rule that fails passage blocks the bill it would have brought up.
  assert.equal(
    deriveBillStatus(["Introduced in House"], "Rule H. Res. 1175 failed passage of House."),
    "Failed",
  );
  // Tabling the motion to reconsider makes an earlier defeat final -- the "to table" wording
  // here describes the motion, not something the bill survived.
  assert.equal(
    deriveBillStatus(
      ["Introduced in Senate", "Referred to the Committee on Finance."],
      "Motion to table the motion to reconsider the vote by which S.J. Res. 49 failed of passage (Record Vote No. 225) agreed to in Senate.",
    ),
    "Failed",
  );
});

test("deriveBillStatus reads the Clerk's own passage wording", () => {
  // "On passage Passed by the Yeas and Nays: 232 - 198 (Roll no. 280)." is how the House records
  // the vote that passes a bill, and it matched nothing -- H.R. 7008 passed 232-198 and still
  // reported "Introduced".
  assert.equal(
    deriveBillStatus(["On passage Passed by the Yeas and Nays: 232 - 198 (Roll no. 280)."]),
    "Passed Chamber",
  );
  assert.equal(
    deriveBillStatus(["On motion to suspend the rules and pass the bill Agreed to by voice vote."]),
    "Passed Chamber",
  );
});

test("deriveBillStatus treats receipt by the other chamber as proof of passage", () => {
  // Often the only stored action saying the originating chamber passed it.
  assert.equal(deriveBillStatus([], "Received in the Senate."), "Passed Chamber");
  assert.equal(deriveBillStatus([], "Held at the desk."), "Passed Chamber");
});

test("deriveBillStatus does not read a failed recommit as the bill failing", () => {
  // The bill survived that motion; only the motion failed.
  assert.equal(
    deriveBillStatus(
      ["On passage Passed by the Yeas and Nays: 232 - 198 (Roll no. 280)."],
      "On motion to recommit Failed by the Yeas and Nays: 211 - 218 (Roll no. 279).",
    ),
    "Passed Chamber",
  );
});

test("deriveBillStatus still takes the furthest rung across the whole history", () => {
  assert.equal(
    deriveBillStatus([
      "Introduced in House",
      "Referred to the House Committee on House Administration.",
      "Placed on the Union Calendar, Calendar No. 409.",
      "On passage Passed by the Yeas and Nays: 232 - 198 (Roll no. 280).",
    ], "Received in the Senate."),
    "Passed Chamber",
  );
});
