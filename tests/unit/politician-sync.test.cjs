const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { syncPoliticiansFromCongress } = jiti("@/lib/server/politician-sync");
const { buildSourceFingerprint, normalizeSourceUpdatedAt } = jiti("@/lib/server/sync-freshness");

test("syncPoliticiansFromCongress skips unchanged members before detail fetch in incremental mode", async () => {
  process.env.CONGRESS_API_KEY = "test-key";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";

  const member = {
    bioguideId: "A000001",
    firstName: "Ada",
    lastName: "Lovelace",
    state: "CA",
    district: 12,
    partyName: "Democratic",
    updateDate: "2026-01-03T00:00:00Z",
    terms: [
      {
        chamber: "House of Representatives",
        district: 12,
        startYear: 2025,
        endYear: 2026,
      },
    ],
  };

  const sourceFingerprint = buildSourceFingerprint({
    bioguideId: member.bioguideId,
    updateDate: member.updateDate,
    firstName: member.firstName,
    lastName: member.lastName,
    state: member.state,
    district: member.district,
    terms: member.terms,
    partyName: member.partyName,
    officeAddress: null,
    phoneNumber: null,
    website: null,
    sponsoredCount: null,
  });

  const originalFetch = global.fetch;
  let memberDetailFetches = 0;
  let politicianWrites = 0;

  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";

    if (url.hostname === "api.congress.gov") {
      if (url.pathname === "/v3/member") {
        return {
          ok: true,
          async json() {
            return { members: [member] };
          },
        };
      }

      if (url.pathname === "/v3/member/A000001") {
        memberDetailFetches += 1;
        throw new Error("member detail should not be fetched for unchanged member");
      }

      throw new Error(`Unexpected Congress URL: ${url.toString()}`);
    }

    if (url.hostname === "example.supabase.co") {
      if (method === "GET" && url.pathname === "/rest/v1/politicians") {
        return {
          ok: true,
          async json() {
            return [{
              id: "A000001",
              slug: "ada-lovelace",
              name: "Ada Lovelace",
              title: "US Representative",
              party: "Democratic",
              state: "CA",
              district: "CA-12",
              biography: "",
              born: "",
              education: "",
              occupation: "",
              website: "",
              office_phone: "",
              office_address: "",
              next_election: "",
              stats: {
                votesWithParty: 0,
                votesAgainstParty: 0,
                attendance: 0,
                billsIntroduced: 0,
                billsPassed: 0,
                amendmentsOffered: 0,
              },
              ideology: {},
              source: "congress_sync",
              source_system: "congress",
              source_id: "A000001",
              jurisdiction_type: "federal",
              state_code: "CA",
              session_id: null,
              source_updated_at: normalizeSourceUpdatedAt(member.updateDate),
              source_fingerprint: sourceFingerprint,
              last_profile_synced_at: "2026-07-11T00:00:00.000Z",
              last_stats_recomputed_at: "2026-07-11T00:00:00.000Z",
              synced_at: "2026-07-11T00:00:00.000Z",
              raw_payload: member,
              raw_member: member,
            }];
          },
        };
      }

      if (method === "GET" && url.pathname === "/rest/v1/vote_positions") {
        return {
          ok: true,
          async json() {
            return [];
          },
        };
      }

      if (method === "GET" && url.pathname === "/rest/v1/bills") {
        return {
          ok: true,
          async json() {
            return [];
          },
        };
      }

      if (method === "POST" && url.pathname === "/rest/v1/politicians") {
        politicianWrites += 1;
        return {
          ok: true,
          async json() {
            return JSON.parse(String(init.body || "[]"));
          },
        };
      }

      throw new Error(`Unexpected Supabase URL: ${method} ${url.toString()}`);
    }

    throw new Error(`Unexpected fetch: ${method} ${url.toString()}`);
  };

  try {
    const result = await syncPoliticiansFromCongress();
    assert.equal(result.unchangedPoliticiansSkipped, 1);
    assert.equal(result.changedPoliticians, 0);
    assert.equal(result.newPoliticians, 0);
    assert.equal(result.skippedMembers.length, 1);
    assert.equal(result.skippedMembers[0].name, "Ada Lovelace");
    assert.equal(result.updatedMembers.length, 0);
    assert.equal(memberDetailFetches, 0);
    assert.equal(politicianWrites, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("syncPoliticiansFromCongress supports chunked member scans with offset and limit", async () => {
  process.env.CONGRESS_API_KEY = "test-key";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  process.env.POLITICA_POLITICIAN_DETAIL_CONCURRENCY = "2";

  const allMembers = [
    {
      bioguideId: "A000001",
      firstName: "Ada",
      lastName: "Lovelace",
      state: "CA",
      district: 12,
      partyName: "Democratic",
      updateDate: "2026-01-03T00:00:00Z",
      terms: [{ chamber: "House of Representatives", district: 12, startYear: 2025, endYear: 2026 }],
    },
    {
      bioguideId: "B000002",
      firstName: "Barbara",
      lastName: "Liskov",
      state: "MA",
      district: 7,
      partyName: "Democratic",
      updateDate: "2026-01-04T00:00:00Z",
      terms: [{ chamber: "House of Representatives", district: 7, startYear: 2025, endYear: 2026 }],
    },
    {
      bioguideId: "C000003",
      firstName: "Claude",
      lastName: "Shannon",
      state: "MI",
      district: 3,
      partyName: "Independent",
      updateDate: "2026-01-05T00:00:00Z",
      terms: [{ chamber: "House of Representatives", district: 3, startYear: 2025, endYear: 2026 }],
    },
  ];

  const originalFetch = global.fetch;
  const listCalls = [];

  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";

    if (url.hostname === "api.congress.gov") {
      if (url.pathname === "/v3/member") {
        listCalls.push(url.toString());
        const limit = Number(url.searchParams.get("limit") || "0");
        const offset = Number(url.searchParams.get("offset") || "0");
        return {
          ok: true,
          async json() {
            return { members: allMembers.slice(offset, offset + limit) };
          },
        };
      }

      if (url.pathname.startsWith("/v3/member/")) {
        const bioguideId = url.pathname.split("/").pop();
        const member = allMembers.find((item) => item.bioguideId === bioguideId);
        return {
          ok: true,
          async json() {
            return {
              member: {
                ...member,
                firstName: member.firstName,
                lastName: member.lastName,
                state: member.state,
                district: member.district,
                partyName: member.partyName,
                officialWebsiteUrl: "",
                addressInformation: {
                  officeAddress: "",
                  phoneNumber: "",
                },
                sponsoredLegislation: {
                  count: 0,
                },
              },
            };
          },
        };
      }

      throw new Error(`Unexpected Congress URL: ${url.toString()}`);
    }

    if (url.hostname === "example.supabase.co") {
      if (method === "GET" && url.pathname === "/rest/v1/politicians") {
        return {
          ok: true,
          async json() {
            return [];
          },
        };
      }

      if (method === "GET" && url.pathname === "/rest/v1/vote_positions") {
        return {
          ok: true,
          async json() {
            return [];
          },
        };
      }

      if (method === "GET" && url.pathname === "/rest/v1/bills") {
        return {
          ok: true,
          async json() {
            return [];
          },
        };
      }

      if (method === "POST" && url.pathname === "/rest/v1/politicians") {
        return {
          ok: true,
          async json() {
            return JSON.parse(String(init.body || "[]"));
          },
        };
      }

      throw new Error(`Unexpected Supabase URL: ${method} ${url.toString()}`);
    }

    throw new Error(`Unexpected fetch: ${method} ${url.toString()}`);
  };

  try {
    const result = await syncPoliticiansFromCongress({ listOffset: 1, listLimit: 2 });
    assert.equal(result.scannedMembers, 2);
    assert.equal(result.synced, 2);
    assert.equal(result.updatedMembers.length, 2);
    assert.equal(result.skippedMembers.length, 0);
    assert.equal(result.requestedOffset, 1);
    assert.equal(result.requestedLimit, 2);
    assert.equal(listCalls.length, 1);
    assert.match(listCalls[0], /offset=1/);
    assert.match(listCalls[0], /limit=2/);
  } finally {
    global.fetch = originalFetch;
    delete process.env.POLITICA_POLITICIAN_DETAIL_CONCURRENCY;
  }
});

test("syncPoliticiansFromCongress preserves stored derived stats without replaying vote or bill history", async () => {
  process.env.CONGRESS_API_KEY = "test-key";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  process.env.POLITICA_POLITICIAN_DETAIL_CONCURRENCY = "2";

  const allMembers = [
    {
      bioguideId: "A000001",
      firstName: "Ada",
      lastName: "Lovelace",
      state: "CA",
      district: 12,
      partyName: "Democratic",
      updateDate: "2026-01-03T00:00:00Z",
      terms: [{ chamber: "House of Representatives", district: 12, startYear: 2025, endYear: 2026 }],
    },
    {
      bioguideId: "B000002",
      firstName: "Barbara",
      lastName: "Liskov",
      state: "MA",
      district: 7,
      partyName: "Democratic",
      updateDate: "2026-01-04T00:00:00Z",
      terms: [{ chamber: "House of Representatives", district: 7, startYear: 2025, endYear: 2026 }],
    },
  ];

  const originalFetch = global.fetch;
  let politicianVotePositionCalls = 0;
  let sponsorBillCalls = 0;

  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";

    if (url.hostname === "api.congress.gov") {
      if (url.pathname === "/v3/member") {
        return {
          ok: true,
          async json() {
            return { members: allMembers };
          },
        };
      }

      if (url.pathname.startsWith("/v3/member/")) {
        const bioguideId = url.pathname.split("/").pop();
        const member = allMembers.find((item) => item.bioguideId === bioguideId);
        return {
          ok: true,
          async json() {
            return {
              member: {
                ...member,
                officialWebsiteUrl: "",
                addressInformation: {
                  officeAddress: "",
                  phoneNumber: "",
                },
                sponsoredLegislation: {
                  count: 0,
                },
              },
            };
          },
        };
      }

      throw new Error(`Unexpected Congress URL: ${url.toString()}`);
    }

    if (url.hostname === "example.supabase.co") {
      if (method === "GET" && url.pathname === "/rest/v1/politicians") {
        return {
          ok: true,
          async json() {
            return [{
              id: "A000001",
              slug: "ada-lovelace",
              name: "Ada Lovelace",
              title: "US Representative",
              party: "Democratic",
              state: "CA",
              district: "CA-12",
              biography: "",
              born: "",
              education: "",
              occupation: "",
              website: "",
              office_phone: "",
              office_address: "",
              next_election: "",
              stats: {
                votesWithParty: 88,
                votesAgainstParty: 12,
                attendance: 97,
                billsIntroduced: 5,
                billsPassed: 2,
                amendmentsOffered: 0,
                totalVotes: 100,
                castVotes: 97,
                withPartyCount: 44,
                againstPartyCount: 6,
              },
              ideology: {},
              source: "congress_sync",
              source_system: "congress",
              source_id: "A000001",
              jurisdiction_type: "federal",
              state_code: "CA",
              session_id: null,
              source_updated_at: null,
              source_fingerprint: null,
              last_profile_synced_at: "2026-07-12T00:00:00.000Z",
              last_stats_recomputed_at: "2026-07-12T00:00:00.000Z",
              synced_at: "2026-07-12T00:00:00.000Z",
              raw_payload: {},
              raw_member: {},
            }];
          },
        };
      }

      if (method === "GET" && url.pathname === "/rest/v1/vote_positions") {
        const query = url.search;
        if (query.includes("politician_id=in.")) {
          politicianVotePositionCalls += 1;
          return {
            ok: true,
            async json() {
              return [];
            },
          };
        }
      }

      if (method === "GET" && url.pathname === "/rest/v1/bills") {
        sponsorBillCalls += 1;
        return {
          ok: true,
          async json() {
            return [
              { id: "hr-1", sponsor_id: "A000001", sponsor_name: "Ada Lovelace", status: "Signed" },
              { id: "hr-2", sponsor_id: "B000002", sponsor_name: "Barbara Liskov", status: "Introduced" },
            ];
          },
        };
      }

      if (method === "POST" && url.pathname === "/rest/v1/politicians") {
        return {
          ok: true,
          async json() {
            return JSON.parse(String(init.body || "[]"));
          },
        };
      }

      throw new Error(`Unexpected Supabase URL: ${method} ${url.toString()}`);
    }

    throw new Error(`Unexpected fetch: ${method} ${url.toString()}`);
  };

  try {
    const result = await syncPoliticiansFromCongress({ listOffset: 0, listLimit: 2 });
    assert.equal(result.synced, 2);
    assert.equal(result.updatedMembers.length, 2);
    assert.equal(result.updatedMembers[0].changeType, "changed");
    assert.equal(politicianVotePositionCalls, 0);
    assert.equal(sponsorBillCalls, 0);
  } finally {
    global.fetch = originalFetch;
    delete process.env.POLITICA_POLITICIAN_DETAIL_CONCURRENCY;
  }
});
