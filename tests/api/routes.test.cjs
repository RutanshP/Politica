const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const searchRoute = jiti("@/app/api/search/route");
const syncStatusRoute = jiti("@/app/api/sync-status/route");
const internalRebuildRoute = jiti("@/app/api/internal/rebuild/route");

test("search route returns an unconfigured payload without Supabase env", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;

  const response = await searchRoute.GET(new Request("http://localhost/api/search?q=budget"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.source, "unconfigured");
  assert.deepEqual(body.results, []);
});

test("sync-status route returns an unconfigured payload without Supabase env", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;

  const response = await syncStatusRoute.GET();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.source, "unconfigured");
  assert.deepEqual(body.runs, []);
});

test("protected rebuild route rejects unauthorized requests", async () => {
  delete process.env.POLITICA_SYNC_SECRET;

  const response = await internalRebuildRoute.POST(new Request("http://localhost/api/internal/rebuild", {
    method: "POST",
  }));
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error, "Unauthorized");
});
