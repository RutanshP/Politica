const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const billsRoute = jiti("@/app/api/bills/route");
const billDetailRoute = jiti("@/app/api/bills/[billId]/route");

test("bill detail route returns stored summary, actions, and versions for a synced bill", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";

  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.pathname === "/rest/v1/bills") {
      const idFilter = url.searchParams.get("id");
      const jurisdictionType = url.searchParams.get("jurisdiction_type");
      return {
        ok: true,
        async json() {
          if (idFilter === "eq.hr-493") {
            return [{
              id: "hr-493",
              slug: "hr-493",
              number: "HR.493",
              title: "FAIR Act",
              summary: "Official summary for FAIR Act.",
              jurisdiction: "Federal",
              country: "United States",
              state: null,
              chamber: "House",
              status: "Introduced",
              topic: "Labor",
              sponsor_id: "A0001",
              sponsor_name: "Rep. Ada Lovelace",
              committee_id: "house-education",
              committee_name: "Education and Workforce",
              latest_action: "Placed on calendar",
              last_action_at: "Jul 1, 2026",
              introduced_at: "Jan 5, 2026",
              session: "119th Congress",
              chance_of_passing: 51,
              stats: { votes: 1, amendments: 0, cosponsors: 2, bipartisanScore: 40 },
              related_bill_ids: [],
              source: "congress_sync",
              source_system: "congress",
              source_id: "hr-493",
              jurisdiction_type: "federal",
              state_code: null,
              session_id: null,
              synced_at: "2026-07-11T20:00:00.000Z",
              raw_payload: {},
              raw_bill: {},
            }];
          }

          if (jurisdictionType === "eq.state") {
            return [];
          }

          return [{
            id: "hr-493",
            slug: "hr-493",
            number: "HR.493",
            title: "FAIR Act",
            summary: "Official summary for FAIR Act.",
            jurisdiction: "Federal",
            country: "United States",
            state: null,
            chamber: "House",
            status: "Introduced",
            topic: "Labor",
            sponsor_id: "A0001",
            sponsor_name: "Rep. Ada Lovelace",
            committee_id: "house-education",
            committee_name: "Education and Workforce",
            latest_action: "Placed on calendar",
            last_action_at: "Jul 1, 2026",
            introduced_at: "Jan 5, 2026",
            session: "119th Congress",
            chance_of_passing: 51,
            stats: { votes: 1, amendments: 0, cosponsors: 2, bipartisanScore: 40 },
            related_bill_ids: [],
            source: "congress_sync",
            source_system: "congress",
            source_id: "hr-493",
            jurisdiction_type: "federal",
            state_code: null,
            session_id: null,
            synced_at: "2026-07-11T20:00:00.000Z",
            raw_payload: {},
            raw_bill: {},
          }];
        },
      };
    }

    if (url.pathname === "/rest/v1/bill_actions") {
      return {
        ok: true,
        async json() {
          return [
            { bill_id: "hr-493", sort_order: 0, date: "Jan 5, 2026", label: "Intro", detail: "Introduced in House", type: "milestone" },
            { bill_id: "hr-493", sort_order: 1, date: "Feb 8, 2026", label: "Committee", detail: "Referred to committee", type: "committee" },
          ];
        },
      };
    }

    if (url.pathname === "/rest/v1/bill_versions") {
      return {
        ok: true,
        async json() {
          return [
            {
              bill_id: "hr-493",
              version_id: "hr-493-text-1",
              sort_order: 0,
              label: "Introduced in House",
              date: "Jul 1, 2026",
              type: "Introduced in House",
              content: ["Section 1.", "FAIR Act text."],
              source_url: "https://example.com/hr493.txt",
              formats: [{ type: "Formatted Text", url: "https://example.com/hr493.txt" }],
              is_full_text_available: true,
            },
          ];
        },
      };
    }

    if (url.pathname === "/rest/v1/sync_runs") {
      return {
        ok: true,
        async json() {
          return [{
            pipeline: "federal_legislation_sync",
            status: "success",
            record_count: 1,
            started_at: "2026-07-11T20:00:00.000Z",
            finished_at: "2026-07-11T20:01:00.000Z",
            error_message: null,
            metadata: {},
          }];
        },
      };
    }

    throw new Error(`Unexpected fetch for ${url.toString()}`);
  };

  try {
    const listResponse = await billsRoute.GET();
    const listBody = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.equal(listBody.bills[0].summary, "Official summary for FAIR Act.");

    const detailResponse = await billDetailRoute.GET(
      new Request("http://localhost/api/bills/hr-493"),
      { params: Promise.resolve({ billId: "hr-493" }) },
    );
    const detailBody = await detailResponse.json();

    assert.equal(detailResponse.status, 200);
    assert.equal(detailBody.bill.summary, "Official summary for FAIR Act.");
    assert.equal(detailBody.bill.actions.length, 2);
    assert.equal(detailBody.bill.versions.length, 1);
    assert.equal(detailBody.bill.versions[0].isFullTextAvailable, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("bill list route keeps current federal session rows and state rows while excluding stale federal sessions", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  process.env.POLITICA_DEFAULT_CONGRESS = "119";

  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.pathname === "/rest/v1/bills") {
      const jurisdictionType = url.searchParams.get("jurisdiction_type");
      const session = url.searchParams.get("session");

      return {
        ok: true,
        async json() {
          if (jurisdictionType === "eq.federal" && session === "eq.119th Congress") {
            return [{
              id: "hr-493",
              slug: "hr-493",
              number: "HR.493",
              title: "FAIR Act",
              summary: "Current Congress bill.",
              jurisdiction: "Federal",
              country: "United States",
              state: null,
              chamber: "House",
              status: "Introduced",
              topic: "Labor",
              sponsor_id: "A0001",
              sponsor_name: "Rep. Ada Lovelace",
              committee_id: "house-education",
              committee_name: "Education and Workforce",
              latest_action: "Placed on calendar",
              last_action_at: "Jul 1, 2026",
              introduced_at: "Jan 5, 2026",
              session: "119th Congress",
              chance_of_passing: 51,
              stats: { votes: 1, amendments: 0, cosponsors: 2, bipartisanScore: 40 },
              related_bill_ids: [],
              source: "congress_sync",
              source_system: "congress",
              source_id: "hr-493",
              jurisdiction_type: "federal",
              state_code: null,
              session_id: null,
              synced_at: "2026-07-11T20:00:00.000Z",
            }];
          }

          if (jurisdictionType === "eq.state") {
            return [{
              id: "ca-ab-1",
              slug: "ca-ab-1",
              number: "AB.1",
              title: "California State Bill",
              summary: "State bill.",
              jurisdiction: "California",
              country: "United States",
              state: "California",
              chamber: "Assembly",
              status: "Introduced",
              topic: "General",
              sponsor_id: "state-1",
              sponsor_name: "Asm. Ada Example",
              committee_id: "ca-rules",
              committee_name: "Rules",
              latest_action: "Introduced",
              last_action_at: "Jul 1, 2026",
              introduced_at: "Jan 5, 2026",
              session: "CA Session",
              chance_of_passing: 51,
              stats: { votes: 0, amendments: 0, cosponsors: 1, bipartisanScore: 20 },
              related_bill_ids: [],
              source: "openstates_sync",
              source_system: "openstates",
              source_id: "ocd-bill/1",
              jurisdiction_type: "state",
              state_code: "CA",
              session_id: null,
              synced_at: "2026-07-11T20:00:00.000Z",
            }];
          }

          return [{
            id: "hr-100",
            slug: "hr-100",
            number: "HR.100",
            title: "Old Congress bill",
            summary: "Should not be returned.",
            jurisdiction: "Federal",
            country: "United States",
            state: null,
            chamber: "House",
            status: "Introduced",
            topic: "Labor",
            sponsor_id: "A0001",
            sponsor_name: "Rep. Ada Lovelace",
            committee_id: "house-education",
            committee_name: "Education and Workforce",
            latest_action: "Placed on calendar",
            last_action_at: "Jul 1, 2024",
            introduced_at: "Jan 5, 2024",
            session: "118th Congress",
            chance_of_passing: 51,
            stats: { votes: 0, amendments: 0, cosponsors: 2, bipartisanScore: 40 },
            related_bill_ids: [],
            source: "congress_sync",
            source_system: "congress",
            source_id: "hr-100",
            jurisdiction_type: "federal",
            state_code: null,
            session_id: null,
            synced_at: "2026-07-11T20:00:00.000Z",
          }];
        },
      };
    }

    if (url.pathname === "/rest/v1/sync_runs") {
      return {
        ok: true,
        async json() {
          return [{
            pipeline: "federal_legislation_sync",
            status: "success",
            record_count: 2,
            started_at: "2026-07-11T20:00:00.000Z",
            finished_at: "2026-07-11T20:01:00.000Z",
            error_message: null,
            metadata: {},
          }];
        },
      };
    }

    throw new Error(`Unexpected fetch for ${url.toString()}`);
  };

  try {
    const listResponse = await billsRoute.GET();
    const listBody = await listResponse.json();

    assert.equal(listResponse.status, 200);
    assert.deepEqual(
      listBody.bills.map((bill) => bill.id).sort(),
      ["ca-ab-1", "hr-493"],
    );
  } finally {
    global.fetch = originalFetch;
  }
});
