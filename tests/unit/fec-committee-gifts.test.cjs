const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

/*
 * fetchFecCommitteeGiftsToRecipient reads the recipient's own Schedule A, lines 11B and 11C. The
 * stub answers by line number and pages with FEC's keyset `last_index`.
 */
function stubScheduleA(pagesByLine) {
  const seen = [];
  global.fetch = async (input) => {
    const url = new URL(String(input));
    seen.push(url);
    assert.equal(url.pathname, "/v1/schedules/schedule_a/");
    const pages = pagesByLine[url.searchParams.get("line_number")] ?? [[]];
    const index = url.searchParams.get("last_index") ? Number(url.searchParams.get("last_index")) : 0;
    const results = pages[index] ?? [];
    const hasNext = index + 1 < pages.length;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      async json() {
        return {
          results,
          pagination: { last_indexes: hasNext ? { last_index: String(index + 1), last_contribution_receipt_date: "2026-01-01" } : null },
        };
      },
    };
  };
  return seen;
}

const row = (contributor_id, amount, extra = {}) => ({ contributor_id, contribution_receipt_amount: amount, memo_code: null, ...extra });

test("committee gifts are totalled per giver from party and PAC receipt lines", async () => {
  process.env.POLITICA_FEC_API_KEY = "test-key";
  const { fetchFecCommitteeGiftsToRecipient } = jiti("@/lib/adapters/fec");
  const originalFetch = global.fetch;
  const fullPage = Array.from({ length: 100 }, (_, i) => row(`C${String(i).padStart(8, "0")}`, 1000));
  const seen = stubScheduleA({
    "F3-11B": [[row("C00027466", 62000)]],
    // Two pages, so the keyset cursor is followed; AIPAC appears once at $5,000.
    "F3-11C": [fullPage, [row("C00797670", 5000), row("C00000001", 4000)]],
  });
  try {
    const gifts = await fetchFecCommitteeGiftsToRecipient("C00573949", 2026);
    const byId = new Map(gifts.map((gift) => [gift.committee_id, gift]));
    assert.equal(byId.get("C00797670").total, 5000);
    assert.equal(byId.get("C00027466").total, 62000, "party committee money on 11B is included");
    assert.equal(byId.get("C00000001").total, 5000, "the same giver across pages is summed");
    assert.equal(byId.get("C00000001").count, 2);
    assert.ok(seen.every((url) => url.searchParams.get("committee_id") === "C00573949"));
    assert.ok(seen.some((url) => url.searchParams.get("last_index") === "1"), "follows the keyset cursor");
  } finally {
    global.fetch = originalFetch;
  }
});

test("memo lines and rows without a committee id are not counted", async () => {
  process.env.POLITICA_FEC_API_KEY = "test-key";
  const { fetchFecCommitteeGiftsToRecipient } = jiti("@/lib/adapters/fec");
  const originalFetch = global.fetch;
  stubScheduleA({
    "F3-11C": [[row("C00797670", 5000), row("C00797670", 5000, { memo_code: "X" }), row(null, 900)]],
  });
  try {
    const gifts = await fetchFecCommitteeGiftsToRecipient("C00573949", 2026);
    assert.deepEqual(gifts.map((gift) => [gift.committee_id, gift.total]), [["C00797670", 5000]]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("small-dollar share is unitemized giving, not FEC's double-counting size bucket", () => {
  const { buildFecGraphRows } = jiti("@/lib/graph/fec-graph-normalizer");
  const { totals } = buildFecGraphRows(
    { id: "J000299", name: "Mike Johnson", title: "US Representative", party: "Republican", state: "LA" },
    "H6LA04138",
    {
      cycle: 2026,
      totals: [{ receipts: 20976864, individual_contributions: 12263645, individual_unitemized_contributions: 3863049 }],
      committees: [],
      byEmployer: [],
      // FEC's bucket for this member: $11.56M "under $200", which is what showed 94.3%.
      bySize: [{ size: 0, total: 11559115, count: null }],
      scheduleE: [],
    },
  );
  assert.equal(totals.smallDollarContributions, 3863049);
  assert.equal(totals.smallDollarPercentage, 31.5);
});

test("forwarded money a campaign filed on line 11C is not the PAC's gift", async () => {
  process.env.POLITICA_FEC_API_KEY = "test-key";
  const { fetchFecCommitteeGiftsToRecipient } = jiti("@/lib/adapters/fec");
  const originalFetch = global.fetch;
  stubScheduleA({
    "F3-11C": [[
      // Norma Torres's report: AIPAC's own $5,000, plus bundles labelled as earmarks.
      row("C00797670", 5000),
      row("C00797670", 34250, { receipt_type_full: "EARMARKED CONTRIBUTIONS" }),
      row("C00797670", 14100, { receipt_type: "15E" }),
      // WinRed lump sums, labelled or not.
      row("C00694323", 12000),
      row("C00694323", 11874.61, { receipt_type_full: "INTERMEDIARY" }),
      row("C00401224", 900),
    ]],
  });
  try {
    const gifts = await fetchFecCommitteeGiftsToRecipient("C00557652", 2026);
    assert.deepEqual(gifts.map((gift) => [gift.committee_id, gift.total]), [["C00797670", 5000]]);
  } finally {
    global.fetch = originalFetch;
  }
});
