const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { countedAmount, normalizeLdaFiling } = jiti("@/lib/adapters/lda");

test("an outside firm reporting an impossible quarter is stored but not counted", () => {
  // LOC Community Association: $20,000,000 a quarter for a client another firm bills $20,000.
  assert.equal(countedAmount(false, 20_000_000, null), null);
  assert.equal(countedAmount(false, 20_000, null), 20_000);
  assert.equal(countedAmount(false, 1_200_000, null), 1_200_000);
});

test("in-house expenses are counted however large", () => {
  // The U.S. Chamber reported $19,340,000 of its own expenses in Q1 2025.
  assert.equal(countedAmount(true, null, 19_340_000), 19_340_000);
});

test("the raw income stays on the normalized filing", () => {
  const report = normalizeLdaFiling({
    filing_uuid: "abaac383",
    filing_year: 2025,
    filing_type: "Q3",
    filing_period: "third_quarter",
    income: "20000000.00",
    expenses: null,
    dt_posted: "2025-11-12T00:00:00Z",
    registrant: { id: 1, name: "LOC COMMUNITY ASSOCIATION" },
    client: { id: 2, name: "STATE OF LOC NATION GLOBAL PUBLIC BENEFIT CORPORATION" },
    lobbying_activities: [],
  });
  assert.equal(report.filing.income, 20_000_000);
  assert.equal(report.filing.amount, null);
});
