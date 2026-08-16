const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { newestFirst } = jiti("@/lib/server/stock-sync");

/** The Clerk's index as it actually arrives: ordered by surname, not by date. */
const INDEX = [
  { last: "Alford", filingDate: "2026-03-31", docId: "20034201" },
  { last: "Allen", filingDate: "2026-01-15", docId: "20033751" },
  { last: "Hoyle", filingDate: "2026-08-12", docId: "20035100" },
  { last: "Wittman", filingDate: "2026-07-10", docId: "20035001" },
  { last: "Yakym", filingDate: "2026-08-13", docId: "20035200" },
];

test("a bounded run takes the newest filings, not the alphabetically first", () => {
  // The index is ordered by surname, so slicing it directly meant the nightly limit=150 only ever
  // reached Alford through Hoyle -- everyone after that would never have been synced, however long
  // the schedule ran.
  const ordered = newestFirst(INDEX);
  assert.deepEqual(ordered.map((row) => row.last), ["Yakym", "Hoyle", "Wittman", "Alford", "Allen"]);
});

test("the newest filing survives a slice that drops most of the index", () => {
  const top = newestFirst(INDEX).slice(0, 2);
  assert.deepEqual(top.map((row) => row.last), ["Yakym", "Hoyle"]);
});

test("filings sharing a date keep a stable order", () => {
  // Without a tiebreaker, same-day filings can reorder between runs and a bounded slice would take
  // a different subset each night.
  const sameDay = [
    { last: "A", filingDate: "2026-08-13", docId: "20035100" },
    { last: "B", filingDate: "2026-08-13", docId: "20035300" },
    { last: "C", filingDate: "2026-08-13", docId: "20035200" },
  ];
  assert.deepEqual(newestFirst(sameDay).map((row) => row.docId), ["20035300", "20035200", "20035100"]);
  assert.deepEqual(newestFirst([...sameDay].reverse()).map((row) => row.docId), ["20035300", "20035200", "20035100"]);
});

test("a filing with no date sorts last rather than crashing", () => {
  const withNull = [
    { last: "Dated", filingDate: "2026-01-01", docId: "2001" },
    { last: "Undated", filingDate: null, docId: "2002" },
  ];
  assert.equal(newestFirst(withNull)[0].last, "Dated");
});

test("the input array is not mutated", () => {
  const original = INDEX.map((row) => row.last);
  newestFirst(INDEX);
  assert.deepEqual(INDEX.map((row) => row.last), original);
});
