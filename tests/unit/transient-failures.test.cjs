const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

function okJson(body) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Map(),
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("an FEC page that times out is retried instead of failing the whole sync", async () => {
  process.env.POLITICA_FEC_API_KEY = "test-key";
  const { fetchFecCommitteesByIds } = jiti("@/lib/adapters/fec");

  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
    if (calls === 2) {
      return { ok: false, status: 502, statusText: "Bad Gateway", headers: new Map(), async json() { return {}; } };
    }
    return okJson({ results: [], pagination: { pages: 1 } });
  };

  try {
    await fetchFecCommitteesByIds(["C00000001"]);
    assert.equal(calls, 3, "a timeout and a 502 are each retried once");
  } finally {
    global.fetch = originalFetch;
  }
});

test("FEC transient retries give up after two and surface the error", async () => {
  process.env.POLITICA_FEC_API_KEY = "test-key";
  const { fetchFecCommitteesByIds } = jiti("@/lib/adapters/fec");

  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  };

  try {
    await assert.rejects(() => fetchFecCommitteesByIds(["C00000001"]), /fetch failed/);
    assert.equal(calls, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test("a Supabase upsert whose connection drops is retried", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  const { upsertSupabaseRows } = jiti("@/lib/supabase/rest");

  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed");
    return okJson([]);
  };

  try {
    await upsertSupabaseRows("bill_actions", [{ bill_id: "hr-1", sort_order: 0 }], "bill_id,sort_order");
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("a Supabase HTTP error is not retried", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  const { upsertSupabaseRows } = jiti("@/lib/supabase/rest");

  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return { ok: false, status: 400, statusText: "Bad Request", headers: new Map(), async text() { return "bad column"; } };
  };

  try {
    await assert.rejects(() => upsertSupabaseRows("bills", [{ id: "hr-1" }], "id"), /400/);
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("search text cannot add PostgREST parameters", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  const { searchStoredSearchDocuments } = jiti("@/lib/supabase/search");

  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (input) => {
    seen.push(new URL(String(input)));
    return okJson([]);
  };

  try {
    await searchStoredSearchDocuments("x&entity_type=eq.bill", 24);
    assert.equal(seen.length, 2);
    for (const url of seen) {
      assert.equal(url.searchParams.get("entity_type"), null, "no injected filter");
      assert.match(url.searchParams.get("or"), /\*x&entity_type=eq\.bill\*/, "the text stays inside the or() value");
    }
  } finally {
    global.fetch = originalFetch;
  }
});
