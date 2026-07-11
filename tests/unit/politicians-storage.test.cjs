const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { listStoredPoliticians } = jiti("@/lib/supabase/politicians");
const { fetchOpenStatesVotes } = jiti("@/lib/adapters/openstates");

test("listStoredPoliticians rebuilds a display name from raw Congress payload when stored name is blank", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return [{
        id: "A000360",
        slug: "a000360",
        name: "",
        title: "United States Representative",
        party: "Democratic",
        state: "Virginia",
        district: null,
        biography: "",
        born: "",
        education: "",
        occupation: "",
        website: "",
        office_phone: "",
        office_address: "",
        next_election: "",
        stats: {},
        ideology: {},
        source: "congress_sync",
        source_system: "congress",
        source_id: "A000360",
        jurisdiction_type: "federal",
        state_code: "VA",
        session_id: null,
        synced_at: "2026-07-10T00:00:00.000Z",
        raw_payload: null,
        raw_member: {
          firstName: "Don",
          lastName: "Beyer",
          honorificName: "Mr.",
        },
      }];
    },
  });

  try {
    const politicians = await listStoredPoliticians();
    assert.equal(politicians[0].name, "Mr. Don Beyer");
    assert.equal(politicians[0].slug, "a000360");
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchOpenStatesVotes returns stored upstream vote results when the endpoint responds", async () => {
  process.env.POLITICA_OPENSTATES_API_KEY = "test-key";

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        results: [{
          id: "vote-1",
          motion_text: "On passage",
          result: "pass",
        }],
      };
    },
  });

  try {
    const votes = await fetchOpenStatesVotes("ca");
    assert.equal(votes.length, 1);
    assert.equal(votes[0].id, "vote-1");
    assert.equal(votes[0].motion_text, "On passage");
  } finally {
    global.fetch = originalFetch;
    delete process.env.POLITICA_OPENSTATES_API_KEY;
  }
});
