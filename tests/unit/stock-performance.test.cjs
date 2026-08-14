const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const {
  computeTradeReturns,
  priceOnOrAfter,
  shiftDate,
  timingAlpha,
  aggregateYearly,
} = jiti("@/lib/stock-performance");

const { buildFilerIndex, matchFiler, givenNamesAgree, stateFromDistrict } = jiti("@/lib/stock-filer-match");

/** Daily closes from `start`, moving by a fixed daily rate, weekends included. */
function series(start, days, from, dailyRate) {
  const points = [];
  let close = from;
  const cursor = new Date(`${start}T00:00:00Z`);
  for (let index = 0; index < days; index += 1) {
    points.push({ date: cursor.toISOString().slice(0, 10), close: Number(close.toFixed(4)) });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    close *= 1 + dailyRate;
  }
  return points;
}

test("dates shift by whole days across month boundaries", () => {
  assert.equal(shiftDate("2025-07-28", 30), "2025-08-27");
  assert.equal(shiftDate("2025-12-20", 30), "2026-01-19");
  assert.equal(shiftDate("2024-02-28", 1), "2024-02-29");
  assert.equal(shiftDate("not-a-date", 30), null);
});

test("a trade on a closed market resolves to the next session", () => {
  // 2025-07-26 is a Saturday; the next close is Monday's.
  const prices = [
    { date: "2025-07-25", close: 10 },
    { date: "2025-07-28", close: 11 },
  ];
  assert.equal(priceOnOrAfter(prices, "2025-07-26").date, "2025-07-28");
});

test("a price far past the date is not used", () => {
  // Without a tolerance a delisted ticker matches a close months away and the return would
  // describe a different period entirely.
  const prices = [{ date: "2025-12-01", close: 10 }];
  assert.equal(priceOnOrAfter(prices, "2025-07-28"), null);
});

test("alpha is the trade's return over the benchmark's", () => {
  const prices = [
    { date: "2025-01-01", close: 100 },
    { date: "2025-01-31", close: 120 },
  ];
  const benchmark = [
    { date: "2025-01-01", close: 100 },
    { date: "2025-01-31", close: 105 },
  ];

  const [result] = computeTradeReturns({
    transactionDate: "2025-01-01",
    prices,
    benchmark,
    windows: [30],
  });

  assert.equal(result.tradeReturn, 20);
  assert.equal(result.benchmarkReturn, 5);
  assert.equal(result.alpha, 15);
});

test("a window with no completed outcome is omitted, not estimated", () => {
  // A trade made two months ago has no 365-day result. Filling it from the latest price would
  // report a partial period as a full year.
  const prices = series("2025-01-01", 100, 100, 0.001);
  const benchmark = series("2025-01-01", 100, 100, 0.0005);

  const results = computeTradeReturns({
    transactionDate: "2025-01-01",
    prices,
    benchmark,
    windows: [30, 90, 365],
  });

  assert.deepEqual(results.map((row) => row.windowDays), [30, 90]);
});

test("a sale's alpha is flipped so positive always means well timed", () => {
  // Selling before the stock underperformed is a good decision. Left unflipped it would score as
  // a loss, and a member's buys and sells would cancel toward zero regardless of skill.
  assert.equal(timingAlpha("purchase", 12), 12);
  assert.equal(timingAlpha("sale", 12), -12);
  assert.equal(timingAlpha("sale_full", -8), 8);
  assert.equal(timingAlpha("sale_partial", -8), 8);
  assert.equal(timingAlpha("exchange", 5), 5);
});

test("yearly aggregation groups trades and averages timing alpha", () => {
  const [year] = aggregateYearly([
    { year: 2025, transactionType: "purchase", ticker: "AAPL", amountMin: 1001, amountMax: 15000, alpha: 10, tradeReturn: 12, benchmarkReturn: 2 },
    { year: 2025, transactionType: "sale", ticker: "MSFT", amountMin: 15001, amountMax: 50000, alpha: -6, tradeReturn: 1, benchmarkReturn: 7 },
  ]);

  assert.equal(year.year, 2025);
  assert.equal(year.tradeCount, 2);
  assert.equal(year.purchaseCount, 1);
  assert.equal(year.saleCount, 1);
  assert.equal(year.tickerCount, 2);
  // Both were well timed: +10 on the buy, +6 on the sale after flipping.
  assert.equal(year.avgAlpha, 8);
});

test("disclosed totals are summed as a range, never as one number", () => {
  const [year] = aggregateYearly([
    { year: 2024, transactionType: "purchase", ticker: "A", amountMin: 1001, amountMax: 15000, alpha: 1 },
    { year: 2024, transactionType: "purchase", ticker: "B", amountMin: 15001, amountMax: 50000, alpha: 1 },
  ]);

  assert.equal(year.disclosedMin, 16002);
  assert.equal(year.disclosedMax, 65000);
});

test("unscored trades count toward volume but not toward the average", () => {
  // Bonds have no market price and recent trades have no completed window. Showing "3 trades"
  // beside an average drawn from one of them would overstate what the number covers.
  const [year] = aggregateYearly([
    { year: 2025, transactionType: "purchase", ticker: "AAPL", amountMin: 1001, amountMax: 15000, alpha: 20, tradeReturn: 22, benchmarkReturn: 2 },
    { year: 2025, transactionType: "purchase", ticker: null, amountMin: 1001, amountMax: 15000, alpha: null },
    { year: 2025, transactionType: "purchase", ticker: null, amountMin: 1001, amountMax: 15000 },
  ]);

  assert.equal(year.tradeCount, 3);
  assert.equal(year.scoredTradeCount, 1);
  assert.equal(year.avgAlpha, 20);
});

test("years come back newest first", () => {
  const years = aggregateYearly([
    { year: 2021, transactionType: "purchase", ticker: "A", amountMin: 1, amountMax: 2 },
    { year: 2025, transactionType: "purchase", ticker: "B", amountMin: 1, amountMax: 2 },
    { year: 2023, transactionType: "purchase", ticker: "C", amountMin: 1, amountMax: 2 },
  ]);
  assert.deepEqual(years.map((row) => row.year), [2025, 2023, 2021]);
});

// --- filer matching ---------------------------------------------------------

const MEMBERS = [
  { id: "A000055", name: "Robert B. Aderholt", state: "AL", chamber: "house" },
  { id: "A000372", name: "Rick W. Allen", state: "GA", chamber: "house" },
  { id: "M001190", name: "Markwayne Mullin", state: "OK", chamber: "senate" },
  { id: "S000033", name: "Bernard Sanders", state: "VT", chamber: "senate" },
  { id: "S001184", name: "Tim Scott", state: "SC", chamber: "senate" },
  { id: "S001217", name: "Rick Scott", state: "FL", chamber: "senate" },
];

test("a House filer resolves to their bioguide id", () => {
  const index = buildFilerIndex(MEMBERS);
  assert.equal(matchFiler(index, { first: "Robert B.", last: "Aderholt", stateDistrict: "AL04" })?.id, "A000055");
});

test("given names match across the sources' different spellings", () => {
  assert.ok(givenNamesAgree("Robert B.", "Robert"));
  assert.ok(givenNamesAgree("A. Mitchell", "Mitchell"));
  assert.ok(givenNamesAgree("R.", "Richard"));
  assert.ok(!givenNamesAgree("Tim", "Rick"));
});

test("a familiar first name matches the legal one on the filing", () => {
  // Disclosures are filed under a legal name while the roster carries the name the member goes by.
  // "Michael A. Collins" against a stored "Mike Collins" was a real miss: neither equality nor a
  // prefix test resolves it, since "michael" does not start with "mike".
  assert.ok(givenNamesAgree("Mike", "Michael A."));
  assert.ok(givenNamesAgree("William P.", "Bill"));
  assert.ok(givenNamesAgree("Bob", "Robert"));
  assert.ok(givenNamesAgree("Katherine M.", "Kate"));
  // Distinct people must still stay distinct.
  assert.ok(!givenNamesAgree("Mike", "Thomas"));
  assert.ok(!givenNamesAgree("Rick", "Tim"));
});

test("a nickname does not merge two members who share a surname", () => {
  const index = buildFilerIndex([
    { id: "C001093", name: "Mike Collins", state: "GA" },
    { id: "C001111", name: "Thomas Collins", state: "NY" },
  ]);
  assert.equal(matchFiler(index, { first: "Michael A.", last: "Collins", stateDistrict: "GA10" })?.id, "C001093");
});

test("a member who moved chambers matches from their old district", () => {
  // Mullin filed House reports from OK02 through 2022 and Senate reports from OK after. Both must
  // reach the same person, or his history splits in half at the point he changed office.
  const index = buildFilerIndex(MEMBERS);
  assert.equal(matchFiler(index, { first: "Markwayne", last: "Mullin", stateDistrict: "OK02" })?.id, "M001190");
  assert.equal(matchFiler(index, { first: "Markwayne", last: "Mullin" })?.id, "M001190");
});

test("two members sharing a surname are separated by state", () => {
  const index = buildFilerIndex(MEMBERS);
  assert.equal(matchFiler(index, { first: "Rick", last: "Scott", stateDistrict: "FL" })?.id, "S001217");
  assert.equal(matchFiler(index, { first: "Tim", last: "Scott", stateDistrict: "SC" })?.id, "S001184");
});

test("chamber separates members that surname and state cannot", () => {
  // "Rafael E Cruz" is Ted Cruz's legal name. He shares a surname and a state with Monica De La
  // Cruz, and no given name agrees -- but only one of them sits in the chamber that filed.
  const index = buildFilerIndex([
    { id: "C001098", name: "Ted Cruz", state: "TX", chamber: "senate" },
    { id: "D000594", name: "Monica De La Cruz", state: "TX", chamber: "house" },
  ]);

  assert.equal(matchFiler(index, { first: "Rafael E", last: "Cruz", chamber: "senate" })?.id, "C001098");
  assert.equal(matchFiler(index, { first: "Monica", last: "De La Cruz", chamber: "house" })?.id, "D000594");
});

test("chamber is a tiebreaker, never a filter", () => {
  // Mullin sits in the Senate now but filed House reports through 2022. Filtering on chamber would
  // drop that whole era -- the exact split this matcher exists to prevent.
  const index = buildFilerIndex(MEMBERS);
  assert.equal(
    matchFiler(index, { first: "Markwayne", last: "Mullin", stateDistrict: "OK02", chamber: "house" })?.id,
    "M001190",
  );
});

test("a roster name carrying a state still indexes under its surname", () => {
  // Some rows are stored as "Greene (GA)". Stripping only the brackets leaves "greene ga", whose
  // last word is the state -- which filed those members under "ga" and made them unmatchable.
  const index = buildFilerIndex([{ id: "G000596", name: "Greene (GA)", state: "GA" }]);
  assert.equal(matchFiler(index, { first: "Marjorie Taylor", last: "Greene", stateDistrict: "GA14" })?.id, "G000596");
});

test("an unresolvable filer is null rather than a guess", () => {
  // Attributing trades to the wrong member is worse than leaving the filing unmatched; the sync
  // stores these with an explicit status so the count stays visible.
  const index = buildFilerIndex([
    { id: "X000001", name: "Chris Smith", state: "NJ" },
    { id: "X000002", name: "Chris Smith", state: "WA" },
  ]);
  assert.equal(matchFiler(index, { first: "Chris", last: "Smith" }), null);
  assert.equal(matchFiler(index, { first: "Nobody", last: "Nonexistent" }), null);
});

test("state comes from a district code or a bare state", () => {
  assert.equal(stateFromDistrict("AL04"), "AL");
  assert.equal(stateFromDistrict("GA"), "GA");
  assert.equal(stateFromDistrict(""), null);
  assert.equal(stateFromDistrict(null), null);
});
