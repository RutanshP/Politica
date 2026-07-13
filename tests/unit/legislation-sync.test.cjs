const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { syncLegislationFromCongress } = jiti("@/lib/server/legislation-sync");
const { buildSourceFingerprint, normalizeSourceUpdatedAt } = jiti("@/lib/server/sync-freshness");

function createBillRow(id, title, summary, overrides = {}) {
  return {
    id,
    slug: id,
    number: id.toUpperCase(),
    title,
    summary,
    jurisdiction: "Federal",
    country: "United States",
    state: null,
    chamber: "House",
    status: "Introduced",
    topic: "General",
    sponsor_id: "A0001",
    sponsor_name: "Rep. Ada Lovelace",
    committee_id: "house-rules",
    committee_name: "Rules Committee",
    latest_action: "Introduced in House",
    last_action_at: "Jan 5, 2026",
    introduced_at: "Jan 5, 2026",
    session: "119th Congress",
    chance_of_passing: 42,
    stats: {
      votes: 0,
      amendments: 0,
      cosponsors: 1,
      bipartisanScore: 0,
    },
    related_bill_ids: [],
    source: "congress_sync",
    source_system: "congress",
    source_id: id,
    jurisdiction_type: "federal",
    state_code: null,
    session_id: null,
    synced_at: "2026-07-11T00:00:00.000Z",
    raw_payload: {},
    raw_bill: {},
    ...overrides,
  };
}

test("syncLegislationFromCongress preserves existing detailed bills on enrichment failure and prunes stale congress rows", async () => {
  process.env.CONGRESS_API_KEY = "test-key";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  process.env.POLITICA_DEFAULT_CONGRESS = "119";
  process.env.POLITICA_FEDERAL_VOTE_MAX_PER_SESSION = "0";
  process.env.POLITICA_LEGISLATION_DETAIL_CONCURRENCY = "1";

  const originalFetch = global.fetch;
  const deletedUrls = [];
  const upsertedBillBodies = [];

  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";

    if (url.hostname === "api.congress.gov") {
      if (url.pathname === "/v3/bill/119") {
        return {
          ok: true,
          async json() {
            return {
              bills: [
                {
                  congress: "119",
                  type: "hr",
                  number: "493",
                  title: "FAIR Act",
                  originChamber: "House",
                  latestAction: { text: "Introduced in House", actionDate: "2026-01-05" },
                  sponsors: [{ bioguideId: "A0001", fullName: "Rep. Ada Lovelace" }],
                },
                {
                  congress: "119",
                  type: "hr",
                  number: "494",
                  title: "Detail Act",
                  originChamber: "House",
                  latestAction: { text: "Introduced in House", actionDate: "2026-01-06" },
                  sponsors: [{ bioguideId: "A0001", fullName: "Rep. Ada Lovelace" }],
                },
              ],
            };
          },
        };
      }

      if (url.pathname === "/v3/bill/119/hr/493") {
        return {
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          async text() {
            return "boom";
          },
        };
      }

      if (url.pathname === "/v3/bill/119/hr/494") {
        return {
          ok: true,
          async json() {
            return {
              bill: {
                congress: "119",
                number: "494",
                type: "hr",
                introducedDate: "2026-01-06",
                latestAction: {
                  text: "Passed House",
                  actionDate: "2026-02-01",
                },
                titles: [{ title: "Official Detail Act", titleType: "Official Title as Introduced" }],
                sponsors: [{ bioguideId: "A0001", fullName: "Rep. Ada Lovelace" }],
                policyArea: { name: "Technology" },
                committees: { count: 0 },
              },
            };
          },
        };
      }

      if (url.pathname === "/v3/bill/119/hr/494/actions") {
        return {
          ok: true,
          async json() {
            return {
              actions: [
                { actionDate: "2026-01-06", text: "Introduced in House", type: "Intro" },
                { actionDate: "2026-01-12", text: "Referred to committee", type: "Referral" },
                { actionDate: "2026-02-01", text: "Passed House", type: "Passage" },
              ],
            };
          },
        };
      }

      if (url.pathname === "/v3/bill/119/hr/494/summaries") {
        return {
          ok: true,
          async json() {
            return {
              summaries: [
                { text: "Official summary for the detailed bill.", updateDate: "2026-01-07", versionCode: "00" },
              ],
            };
          },
        };
      }

      if (url.pathname === "/v3/bill/119/hr/494/text") {
        return {
          ok: true,
          async json() {
            return {
              textVersions: [
                {
                  date: "2026-01-06",
                  type: "Introduced in House",
                  formats: [{ type: "Formatted Text", url: "https://example.com/hr494.txt" }],
                },
              ],
            };
          },
        };
      }

      if (url.pathname === "/v3/committee/119") {
        return {
          ok: true,
          async json() {
            return { committees: [] };
          },
        };
      }

      throw new Error(`Unexpected Congress URL: ${url.toString()}`);
    }

    if (url.hostname === "example.com" && url.pathname === "/hr494.txt") {
      return {
        ok: true,
        async text() {
          return "Section 1.\n\nThis is the official stored text.";
        },
      };
    }

    if (url.hostname === "example.supabase.co") {
      if (method === "GET" && url.pathname === "/rest/v1/bills") {
        return {
          ok: true,
          async json() {
            return [
              createBillRow("hr-493", "FAIR Act", "Existing stored detailed summary.", {
                latest_action: "Passed House",
                last_action_at: "Feb 1, 2026",
              }),
              createBillRow("hr-999", "Stale Placeholder Act", "Old stale summary."),
            ];
          },
        };
      }

      if (method === "GET" && url.pathname === "/rest/v1/bill_actions") {
        return {
          ok: true,
          async json() {
            return [
              { bill_id: "hr-493", sort_order: 0, date: "Jan 5, 2026", label: "Intro", detail: "Introduced in House", type: "milestone" },
              { bill_id: "hr-493", sort_order: 1, date: "Feb 1, 2026", label: "Floor", detail: "Passed House", type: "floor" },
              { bill_id: "hr-999", sort_order: 0, date: "Jan 1, 2026", label: "Latest action", detail: "Stale placeholder", type: "milestone" },
            ];
          },
        };
      }

      if (method === "GET" && url.pathname === "/rest/v1/bill_versions") {
        return {
          ok: true,
          async json() {
            return [
              {
                bill_id: "hr-493",
                version_id: "hr-493-text-1",
                sort_order: 0,
                label: "Introduced in House",
                date: "Jan 5, 2026",
                type: "Introduced in House",
                content: ["Existing stored full text."],
                source_url: "https://example.com/hr493.txt",
                formats: [{ type: "Formatted Text", url: "https://example.com/hr493.txt" }],
                is_full_text_available: true,
              },
            ];
          },
        };
      }

      if (method === "GET" && url.pathname === "/rest/v1/votes") {
        return {
          ok: true,
          async json() {
            return [];
          },
        };
      }

      if (method === "GET" && url.pathname === "/rest/v1/politicians") {
        return {
          ok: true,
          async json() {
            return [];
          },
        };
      }

      if (method === "POST") {
        if (url.pathname === "/rest/v1/bills") {
          upsertedBillBodies.push(JSON.parse(String(init.body)));
        }
        return {
          ok: true,
          async json() {
            return JSON.parse(String(init.body || "[]"));
          },
        };
      }

      if (method === "DELETE") {
        deletedUrls.push(url.toString());
        return {
          ok: true,
          async text() {
            return "";
          },
        };
      }
    }

    throw new Error(`Unexpected fetch: ${method} ${url.toString()}`);
  };

  try {
    const result = await syncLegislationFromCongress();

    assert.equal(result.detailedBillsSynced, 1);
    assert.equal(result.preservedBills, 1);
    assert.equal(result.staleBillsDeleted, 1);
    assert.equal(result.detailFailures.length, 1);
    assert.equal(result.detailFailures[0].billId, "hr-493");

    const writtenBillIds = upsertedBillBodies.flat().map((row) => row.id);
    assert.ok(writtenBillIds.includes("hr-493"));
    assert.ok(writtenBillIds.includes("hr-494"));
    assert.ok(deletedUrls.some((value) => value.includes("/rest/v1/bills") && value.includes("hr-999")));
  } finally {
    global.fetch = originalFetch;
  }
});

test("syncLegislationFromCongress skips unchanged bills before detail fetch in incremental mode", async () => {
  process.env.CONGRESS_API_KEY = "test-key";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  process.env.POLITICA_DEFAULT_CONGRESS = "119";
  process.env.POLITICA_FEDERAL_VOTE_MAX_PER_SESSION = "0";

  const listBill = {
    congress: "119",
    type: "hr",
    number: "777",
    title: "Stable Act",
    originChamber: "House",
    updateDate: "2026-01-08T00:00:00Z",
    latestAction: { text: "Introduced in House", actionDate: "2026-01-08" },
    sponsors: [{ bioguideId: "A0001", fullName: "Rep. Ada Lovelace" }],
  };
  const sourceFingerprint = buildSourceFingerprint({
    congress: listBill.congress,
    type: listBill.type,
    number: listBill.number,
    updateDate: listBill.updateDate,
    title: listBill.title,
    originChamber: listBill.originChamber,
    latestAction: listBill.latestAction,
    sponsors: listBill.sponsors,
    policyArea: null,
    committees: null,
  });

  const originalFetch = global.fetch;
  let detailFetches = 0;
  let billWrites = 0;

  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";

    if (url.hostname === "api.congress.gov") {
      if (url.pathname === "/v3/bill/119") {
        return {
          ok: true,
          async json() {
            return { bills: [listBill] };
          },
        };
      }

      if (url.pathname === "/v3/bill/119/hr/777") {
        detailFetches += 1;
        throw new Error("detail fetch should not run for unchanged bill");
      }

      throw new Error(`Unexpected Congress URL: ${url.toString()}`);
    }

    if (url.hostname === "example.supabase.co") {
      if (method === "GET" && url.pathname === "/rest/v1/bills") {
        return {
          ok: true,
          async json() {
            return [
              createBillRow("hr-777", "Stable Act", "Existing stored detailed summary.", {
                source_updated_at: normalizeSourceUpdatedAt(listBill.updateDate),
                source_fingerprint: sourceFingerprint,
                last_detail_synced_at: "2026-07-11T00:00:00.000Z",
              }),
            ];
          },
        };
      }

      if (method === "GET" && url.pathname === "/rest/v1/bill_actions") {
        return {
          ok: true,
          async json() {
            return [
              { bill_id: "hr-777", sort_order: 0, date: "Jan 8, 2026", label: "Intro", detail: "Introduced in House", type: "milestone" },
            ];
          },
        };
      }

      if (method === "GET" && url.pathname === "/rest/v1/bill_versions") {
        return {
          ok: true,
          async json() {
            return [];
          },
        };
      }

      if (method === "GET" && url.pathname === "/rest/v1/votes") {
        return {
          ok: true,
          async json() {
            return [];
          },
        };
      }

      if (method === "POST" && url.pathname === "/rest/v1/bills") {
        billWrites += 1;
        return {
          ok: true,
          async json() {
            return JSON.parse(String(init.body || "[]"));
          },
        };
      }

      return {
        ok: true,
        async json() {
          return [];
        },
        async text() {
          return "";
        },
      };
    }

    throw new Error(`Unexpected fetch: ${method} ${url.toString()}`);
  };

  try {
    const result = await syncLegislationFromCongress();
    assert.equal(result.unchangedBillsSkipped, 1);
    assert.equal(result.detailedBillsSynced, 0);
    assert.equal(detailFetches, 0);
    assert.equal(billWrites, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("syncLegislationFromCongress retries transient Congress list failures before succeeding", async () => {
  process.env.CONGRESS_API_KEY = "test-key";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  process.env.POLITICA_DEFAULT_CONGRESS = "119";
  process.env.POLITICA_FEDERAL_VOTE_MAX_PER_SESSION = "0";
  process.env.POLITICA_CONGRESS_FETCH_RETRY_ATTEMPTS = "3";

  const listBill = {
    congress: "119",
    type: "hr",
    number: "778",
    title: "Retry Act",
    originChamber: "House",
    updateDate: "2026-01-09T00:00:00Z",
    latestAction: { text: "Introduced in House", actionDate: "2026-01-09" },
    sponsors: [{ bioguideId: "A0001", fullName: "Rep. Ada Lovelace" }],
  };
  const sourceFingerprint = buildSourceFingerprint({
    congress: listBill.congress,
    type: listBill.type,
    number: listBill.number,
    updateDate: listBill.updateDate,
    title: listBill.title,
    originChamber: listBill.originChamber,
    latestAction: listBill.latestAction,
    sponsors: listBill.sponsors,
    policyArea: null,
    committees: null,
  });

  const originalFetch = global.fetch;
  let listAttempts = 0;
  let detailFetches = 0;

  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";

    if (url.hostname === "api.congress.gov") {
      if (url.pathname === "/v3/bill/119") {
        listAttempts += 1;
        if (listAttempts === 1) {
          const error = new Error("terminated");
          error.cause = { code: "UND_ERR_SOCKET" };
          throw error;
        }

        return {
          ok: true,
          async json() {
            return { bills: [listBill] };
          },
        };
      }

      if (url.pathname === "/v3/bill/119/hr/778") {
        detailFetches += 1;
        throw new Error("detail fetch should not run for unchanged bill");
      }

      throw new Error(`Unexpected Congress URL: ${url.toString()}`);
    }

    if (url.hostname === "example.supabase.co") {
      if (method === "GET" && url.pathname === "/rest/v1/bills") {
        return {
          ok: true,
          async json() {
            return [
              createBillRow("hr-778", "Retry Act", "Existing stored detailed summary.", {
                source_updated_at: normalizeSourceUpdatedAt(listBill.updateDate),
                source_fingerprint: sourceFingerprint,
                last_detail_synced_at: "2026-07-11T00:00:00.000Z",
              }),
            ];
          },
        };
      }

      if (method === "GET" && url.pathname === "/rest/v1/bill_actions") {
        return {
          ok: true,
          async json() {
            return [
              { bill_id: "hr-778", sort_order: 0, date: "Jan 9, 2026", label: "Intro", detail: "Introduced in House", type: "milestone" },
            ];
          },
        };
      }

      if (method === "GET" && url.pathname === "/rest/v1/bill_versions") {
        return {
          ok: true,
          async json() {
            return [];
          },
        };
      }

      if (method === "GET" && url.pathname === "/rest/v1/votes") {
        return {
          ok: true,
          async json() {
            return [];
          },
        };
      }

      return {
        ok: true,
        async json() {
          return [];
        },
        async text() {
          return "";
        },
      };
    }

    throw new Error(`Unexpected fetch: ${method} ${url.toString()}`);
  };

  try {
    const result = await syncLegislationFromCongress();
    assert.equal(result.unchangedBillsSkipped, 1);
    assert.equal(result.detailedBillsSynced, 0);
    assert.equal(listAttempts, 2);
    assert.equal(detailFetches, 0);
  } finally {
    global.fetch = originalFetch;
    delete process.env.POLITICA_CONGRESS_FETCH_RETRY_ATTEMPTS;
  }
});
