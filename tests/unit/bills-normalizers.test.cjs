const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const {
  chooseCongressBillTitle,
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
