const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { parseBillId, normalizeCongressBillListItem } = jiti("@/lib/normalizers/bills");

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
