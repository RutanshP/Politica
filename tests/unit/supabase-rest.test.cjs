const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { fetchSupabaseRows, withTotalOrder } = jiti("@/lib/supabase/rest");

test("withTotalOrder adds an order clause when the caller supplied none", () => {
  // listStoredBills paginated with no order at all, so pages overlapped and skipped rows.
  assert.equal(
    withTotalOrder("jurisdiction_type=eq.federal&session=eq.119th%20Congress", "id"),
    "jurisdiction_type=eq.federal&session=eq.119th%20Congress&order=id.asc",
  );
  assert.equal(withTotalOrder(undefined, "id"), "order=id.asc");
  assert.equal(withTotalOrder("", "id"), "order=id.asc");
});

test("withTotalOrder appends a tiebreaker to a non-unique order", () => {
  assert.equal(
    withTotalOrder("vote_id=in.(\"a\",\"b\")&order=vote_id.asc,name.asc", "politician_id"),
    "vote_id=in.(\"a\",\"b\")&order=vote_id.asc,name.asc,politician_id.asc",
  );
  assert.equal(
    withTotalOrder("order=amount.desc.nullslast", "id"),
    "order=amount.desc.nullslast,id.asc",
  );
});

test("withTotalOrder leaves an order that already contains the tiebreaker alone", () => {
  assert.equal(withTotalOrder("order=id.asc", "id"), "order=id.asc");
  assert.equal(withTotalOrder("order=id.desc", "id"), "order=id.desc");
  assert.equal(
    withTotalOrder("order=bill_id.asc,sort_order.asc", "sort_order"),
    "order=bill_id.asc,sort_order.asc",
  );
});

test("withTotalOrder trusts a caller that declares its own order total", () => {
  // bill_actions/bill_versions have no `id` to append; their order is the primary key.
  assert.equal(
    withTotalOrder("bill_id=eq.hr-1&order=sort_order.asc", null),
    "bill_id=eq.hr-1&order=sort_order.asc",
  );
});

test("withTotalOrder refuses to paginate with no order and no tiebreaker", () => {
  assert.throws(() => withTotalOrder("status=eq.Failed", null), /order clause or a tiebreaker/);
});

test("fetchSupabaseRows paginates through every Supabase page when paginateAll is enabled", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";

  const originalFetch = global.fetch;
  const seenUrls = [];
  global.fetch = async (input) => {
    const url = new URL(String(input));
    seenUrls.push(url.toString());

    const offset = Number(url.searchParams.get("offset") || "0");
    const limit = Number(url.searchParams.get("limit") || "0");

    assert.equal(url.pathname, "/rest/v1/bills");
    assert.equal(limit, 250);

    const rows = offset === 0
      ? Array.from({ length: 250 }, (_, index) => ({ id: `bill-${index}` }))
      : Array.from({ length: 125 }, (_, index) => ({ id: `bill-${250 + index}` }));

    return {
      ok: true,
      async json() {
        return rows;
      },
    };
  };

  try {
    const rows = await fetchSupabaseRows("bills", "order=id.asc", {
      cache: "no-store",
      paginateAll: true,
    });

    assert.equal(rows.length, 375);
    assert.equal(seenUrls.length, 2);
    assert.match(seenUrls[0], /offset=0/);
    assert.match(seenUrls[1], /offset=250/);
  } finally {
    global.fetch = originalFetch;
  }
});


/** Captures the JSON bodies upsertSupabaseRows sends, with fetch stubbed out. */
async function captureUpsertBodies(run) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";

  const originalFetch = global.fetch;
  const bodies = [];
  global.fetch = async (input, init) => {
    bodies.push(JSON.parse(init.body));
    return {
      ok: true,
      status: 204,
      statusText: "No Content",
      async json() {
        return [];
      },
      async text() {
        return "";
      },
    };
  };

  try {
    await run();
  } finally {
    global.fetch = originalFetch;
  }

  return bodies;
}

/*
 * Postgres rejects the whole command when one ON CONFLICT batch touches the same target twice,
 * and FEC's /candidates/ endpoint pages by offset, so a candidate can arrive on two pages. That
 * failure took down the entire election-candidates sync.
 */
test("upsertSupabaseRows collapses rows sharing a conflict target", async () => {
  const { upsertSupabaseRows } = jiti("@/lib/supabase/rest");

  const bodies = await captureUpsertBodies(() =>
    upsertSupabaseRows(
      "election_candidates",
      [
        { id: "H0CA01-2026", name: "First" },
        { id: "H0CA02-2026", name: "Second" },
        { id: "H0CA01-2026", name: "First (repeat)" },
      ],
      "id",
    ));

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].length, 2, "duplicate id must be collapsed");
  assert.deepEqual(bodies[0].map((row) => row.id), ["H0CA01-2026", "H0CA02-2026"]);
  // Last occurrence wins, so a later page's copy is the one written.
  assert.equal(bodies[0][0].name, "First (repeat)");
});

test("upsertSupabaseRows dedupes on a composite conflict target", async () => {
  const { upsertSupabaseRows } = jiti("@/lib/supabase/rest");

  const bodies = await captureUpsertBodies(() =>
    upsertSupabaseRows(
      "vote_positions",
      [
        { vote_id: "v1", politician_id: "p1", vote: "Yea" },
        { vote_id: "v1", politician_id: "p2", vote: "Nay" },
        { vote_id: "v1", politician_id: "p1", vote: "Nay" },
      ],
      "vote_id,politician_id",
    ));

  assert.equal(bodies[0].length, 2, "same (vote_id, politician_id) must collapse");
  // A different politician on the same vote is not a duplicate.
  assert.deepEqual(bodies[0].map((row) => row.politician_id), ["p1", "p2"]);
});

test("upsertSupabaseRows leaves a batch without duplicates untouched", async () => {
  const { upsertSupabaseRows } = jiti("@/lib/supabase/rest");

  const bodies = await captureUpsertBodies(() =>
    upsertSupabaseRows("bills", [{ id: "hr-1" }, { id: "hr-2" }, { id: "hr-3" }], "id"));

  assert.deepEqual(bodies[0].map((row) => row.id), ["hr-1", "hr-2", "hr-3"]);
});
