const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

test("an exhausted FEC hourly quota fails fast instead of sleeping past the function timeout", async () => {
  process.env.POLITICA_FEC_API_KEY = "test-key";
  const { fetchFecCommitteesByIds, FecQuotaExhaustedError } = jiti("@/lib/adapters/fec");

  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: new Map([["retry-after", "837"]]),
      async json() {
        return {};
      },
    };
  };

  const started = Date.now();
  try {
    await assert.rejects(() => fetchFecCommitteesByIds(["C00000001"]), (error) => {
      assert.ok(error instanceof FecQuotaExhaustedError);
      assert.equal(error.retryAfterSeconds, 837);
      return true;
    });
    assert.equal(calls, 1, "does not retry into a fourteen-minute wait");
    assert.ok(Date.now() - started < 5000);
  } finally {
    global.fetch = originalFetch;
  }
});
