const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

test("the sync secret is accepted only when it matches exactly", () => {
  process.env.POLITICA_SYNC_SECRET = "s3cret-value";
  const { isAuthorizedSyncRequest } = jiti("@/lib/server/internal-api");
  const request = (headers) => new Request("https://example.test/api/internal/sync/news", { method: "POST", headers });

  assert.equal(isAuthorizedSyncRequest(request({ Authorization: "Bearer s3cret-value" })), true);
  assert.equal(isAuthorizedSyncRequest(request({ "x-sync-secret": "s3cret-value" })), true);
  assert.equal(isAuthorizedSyncRequest(request({ Authorization: "Bearer s3cret-valuX" })), false);
  assert.equal(isAuthorizedSyncRequest(request({ Authorization: "Bearer s3cret" })), false, "a prefix of different length");
  assert.equal(isAuthorizedSyncRequest(request({})), false);
});
