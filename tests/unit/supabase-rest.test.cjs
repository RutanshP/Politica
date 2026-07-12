const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { fetchSupabaseRows } = jiti("@/lib/supabase/rest");

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
