const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { FEDERAL_HOUSE_OFFICE_KEYS, getPoliticiansData } = jiti("@/lib/data/politicians");
const { listStoredPoliticians } = jiti("@/lib/supabase/politicians");
const { fetchOpenStatesVotes } = jiti("@/lib/adapters/openstates");
const { normalizeDistrictSeat } = jiti("@/lib/utils");

test("federal house office registry contains every current voting and non-voting seat", () => {
  assert.equal(FEDERAL_HOUSE_OFFICE_KEYS.length, 441);
  assert.ok(FEDERAL_HOUSE_OFFICE_KEYS.includes("CA-52"));
  assert.ok(FEDERAL_HOUSE_OFFICE_KEYS.includes("DC-AL"));
  assert.ok(FEDERAL_HOUSE_OFFICE_KEYS.includes("PR-AL"));
  assert.ok(FEDERAL_HOUSE_OFFICE_KEYS.includes("GU-AL"));
});

test("normalizeDistrictSeat canonicalizes numbered and at-large seats", () => {
  assert.equal(normalizeDistrictSeat("California", "California-17"), "CA-17");
  assert.equal(normalizeDistrictSeat("CA", 17), "CA-17");
  assert.equal(normalizeDistrictSeat("Alaska", 0), "AK-AL");
  assert.equal(normalizeDistrictSeat("Puerto Rico", "AL"), "PR-AL");
});

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
        title: "US Representative",
        party: "Democratic",
        state: "Virginia",
        district: "VA-8",
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

test("listStoredPoliticians merges duplicate placeholder rows and keeps attendance on the canonical member", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return [
        {
          id: "S000148",
          slug: "alex-padilla",
          name: "Alex Padilla",
          title: "US Senator",
          party: "Democratic",
          state: "California",
          district: null,
          biography: "Senator from California.",
          born: "",
          education: "",
          occupation: "",
          website: "https://www.padilla.senate.gov",
          office_phone: "202-224-3553",
          office_address: "B03 Russell Senate Office Building",
          next_election: "",
          stats: {
            votesWithParty: 0,
            votesAgainstParty: 0,
            attendance: 0,
            billsIntroduced: 4,
            billsPassed: 0,
            amendmentsOffered: 0,
          },
          ideology: {},
          source: "congress_sync",
          source_system: "congress",
          source_id: "S000148",
          jurisdiction_type: "federal",
          state_code: "CA",
          session_id: null,
          synced_at: "2026-07-10T00:00:00.000Z",
          raw_payload: null,
          raw_member: {
            firstName: "Alex",
            lastName: "Padilla",
          },
        },
        {
          id: "unmatched-senatelis-alex-padilla-ca",
          slug: "federal-ca-alex-padilla-unmatched",
          name: "Alex Padilla",
          title: "US Legislator",
          party: "Democratic",
          state: "California",
          district: null,
          biography: "Placeholder federal legislator record created from official roll-call vote data.",
          born: "",
          education: "",
          occupation: "Public official",
          website: "Not available from configured sources",
          office_phone: "Not available from configured sources",
          office_address: "Not available from configured sources",
          next_election: "Federal election calendar not connected",
          stats: {
            votesWithParty: 91,
            votesAgainstParty: 4,
            attendance: 95,
            billsIntroduced: 0,
            billsPassed: 0,
            amendmentsOffered: 0,
          },
          ideology: {},
          source: "congress_sync",
          source_system: "federal_votes",
          source_id: "unmatched-senatelis-alex-padilla-ca",
          jurisdiction_type: "federal",
          state_code: "CA",
          session_id: null,
          synced_at: "2026-07-10T00:00:00.000Z",
          raw_payload: null,
          raw_member: null,
        },
      ];
    },
  });

  try {
    const politicians = await listStoredPoliticians();
    assert.equal(politicians.length, 1);
    assert.equal(politicians[0].name, "Alex Padilla");
    assert.equal(politicians[0].title, "US Senator");
    assert.equal(politicians[0].stats.attendance, 95);
    assert.equal(politicians[0].stats.votesWithParty, 91);
    assert.equal(politicians[0].website, "https://www.padilla.senate.gov");
  } finally {
    global.fetch = originalFetch;
  }
});

test("listStoredPoliticians merges senators when one row uses a state name and the other uses a state code", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return [
        {
          id: "S000148",
          slug: "alex-padilla",
          name: "Alex Padilla",
          title: "US Senator",
          party: "Democratic",
          state: "California",
          district: null,
          biography: "Senator from California.",
          born: "",
          education: "",
          occupation: "",
          website: "https://www.padilla.senate.gov",
          office_phone: "202-224-3553",
          office_address: "B03 Russell Senate Office Building",
          next_election: "",
          stats: {
            votesWithParty: 0,
            votesAgainstParty: 0,
            attendance: 0,
            billsIntroduced: 4,
            billsPassed: 0,
            amendmentsOffered: 0,
          },
          ideology: {},
          source: "congress_sync",
          source_system: "congress",
          source_id: "S000148",
          jurisdiction_type: "federal",
          state_code: null,
          session_id: null,
          synced_at: "2026-07-10T00:00:00.000Z",
          raw_payload: null,
          raw_member: {
            firstName: "Alex",
            lastName: "Padilla",
          },
        },
        {
          id: "unmatched-senatelis-alex-padilla-ca",
          slug: "federal-ca-alex-padilla-unmatched",
          name: "Alex Padilla",
          title: "US Legislator",
          party: "Democratic",
          state: "CA",
          district: null,
          biography: "Placeholder federal legislator record created from official roll-call vote data.",
          born: "",
          education: "",
          occupation: "Public official",
          website: "Not available from configured sources",
          office_phone: "Not available from configured sources",
          office_address: "Not available from configured sources",
          next_election: "Federal election calendar not connected",
          stats: {
            votesWithParty: 91,
            votesAgainstParty: 4,
            attendance: 95,
            billsIntroduced: 0,
            billsPassed: 0,
            amendmentsOffered: 0,
          },
          ideology: {},
          source: "congress_sync",
          source_system: "federal_votes",
          source_id: "unmatched-senatelis-alex-padilla-ca",
          jurisdiction_type: "federal",
          state_code: "CA",
          session_id: null,
          synced_at: "2026-07-10T00:00:00.000Z",
          raw_payload: null,
          raw_member: null,
        },
      ];
    },
  });

  try {
    const politicians = await listStoredPoliticians();
    assert.equal(politicians.length, 1);
    assert.equal(politicians[0].name, "Alex Padilla");
    assert.equal(politicians[0].title, "US Senator");
    assert.equal(politicians[0].state, "California");
    assert.equal(politicians[0].stats.attendance, 95);
  } finally {
    global.fetch = originalFetch;
  }
});

test("listStoredPoliticians merges middle-initial variants and prefers the inferred senate office", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return [
        {
          id: "S001234",
          slug: "adam-b-schiff",
          name: "Adam B. Schiff",
          title: "US Representative",
          party: "Democratic",
          state: "California",
          district: null,
          biography: "Federal member record.",
          born: "",
          education: "",
          occupation: "",
          website: "https://schiff.house.gov",
          office_phone: "202-225-4176",
          office_address: "House Office Building",
          next_election: "",
          stats: {
            votesWithParty: 0,
            votesAgainstParty: 0,
            attendance: 0,
            billsIntroduced: 3,
            billsPassed: 0,
            amendmentsOffered: 0,
          },
          ideology: {},
          source: "congress_sync",
          source_system: "congress",
          source_id: "S001234",
          jurisdiction_type: "federal",
          state_code: "CA",
          session_id: null,
          synced_at: "2026-07-10T00:00:00.000Z",
          raw_payload: null,
          raw_member: {
            firstName: "Adam",
            middleName: "B.",
            lastName: "Schiff",
          },
        },
        {
          id: "unmatched-senatelis-adam-schiff-ca",
          slug: "federal-ca-adam-schiff-unmatched",
          name: "Adam Schiff",
          title: "US Legislator",
          party: "Democratic",
          state: "California",
          district: null,
          biography: "Placeholder federal legislator record created from official roll-call vote data.",
          born: "",
          education: "",
          occupation: "Public official",
          website: "Not available from configured sources",
          office_phone: "Not available from configured sources",
          office_address: "Not available from configured sources",
          next_election: "Federal election calendar not connected",
          stats: {
            votesWithParty: 93,
            votesAgainstParty: 5,
            attendance: 98,
            billsIntroduced: 0,
            billsPassed: 0,
            amendmentsOffered: 0,
          },
          ideology: {},
          source: "congress_sync",
          source_system: "federal_votes",
          source_id: "unmatched-senatelis-adam-schiff-ca",
          jurisdiction_type: "federal",
          state_code: "CA",
          session_id: null,
          synced_at: "2026-07-10T00:00:00.000Z",
          raw_payload: null,
          raw_member: null,
        },
      ];
    },
  });

  try {
    const politicians = await listStoredPoliticians();
    assert.equal(politicians.length, 1);
    assert.equal(politicians[0].name, "Adam B. Schiff");
    assert.equal(politicians[0].title, "US Senator");
    assert.equal(politicians[0].stats.attendance, 98);
    assert.equal(politicians[0].stats.votesWithParty, 93);
  } finally {
    global.fetch = originalFetch;
  }
});

test("listStoredPoliticians keeps only one federal house occupant per district", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return [
        {
          id: "R000017",
          slug: "california-17-canonical",
          name: "Example Member",
          title: "US Representative",
          party: "Democratic",
          state: "California",
          district: "CA-17",
          biography: "Canonical district member.",
          born: "",
          education: "",
          occupation: "",
          website: "https://example.house.gov",
          office_phone: "202-225-0000",
          office_address: "House Office Building",
          next_election: "",
          stats: {
            votesWithParty: 0,
            votesAgainstParty: 0,
            attendance: 0,
            billsIntroduced: 2,
            billsPassed: 0,
            amendmentsOffered: 0,
          },
          ideology: {},
          source: "congress_sync",
          source_system: "congress",
          source_id: "R000017",
          jurisdiction_type: "federal",
          state_code: "CA",
          session_id: null,
          synced_at: "2026-07-10T00:00:00.000Z",
          raw_payload: null,
          raw_member: {
            firstName: "Example",
            lastName: "Member",
          },
        },
        {
          id: "unmatched-houseclerk-example-member-ca",
          slug: "ca-example-member-unmatched",
          name: "Example Member",
          title: "US Legislator",
          party: "Democratic",
          state: "California",
          district: null,
          biography: "Placeholder federal legislator record created from official roll-call vote data.",
          born: "",
          education: "",
          occupation: "Public official",
          website: "Not available from configured sources",
          office_phone: "Not available from configured sources",
          office_address: "Not available from configured sources",
          next_election: "Federal election calendar not connected",
          stats: {
            votesWithParty: 94,
            votesAgainstParty: 3,
            attendance: 97,
            billsIntroduced: 0,
            billsPassed: 0,
            amendmentsOffered: 0,
          },
          ideology: {},
          source: "congress_sync",
          source_system: "federal_votes",
          source_id: "unmatched-houseclerk-example-member-ca",
          jurisdiction_type: "federal",
          state_code: "CA",
          session_id: null,
          synced_at: "2026-07-10T00:00:00.000Z",
          raw_payload: null,
          raw_member: null,
        },
      ];
    },
  });

  try {
    const politicians = await listStoredPoliticians();
    assert.equal(politicians.length, 1);
    assert.equal(politicians[0].title, "US Representative");
    assert.equal(politicians[0].district, "CA-17");
    assert.equal(politicians[0].stats.attendance, 97);
  } finally {
    global.fetch = originalFetch;
  }
});

test("listStoredPoliticians restores a federal house seat from raw Congress district data and keeps attendance", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return [
        {
          id: "R001001",
          slug: "sample-house-member",
          name: "Sample House Member",
          title: "US Representative",
          party: "Democratic",
          state: "California",
          district: null,
          biography: "Canonical House member.",
          born: "",
          education: "",
          occupation: "",
          website: "https://example.house.gov",
          office_phone: "202-225-1111",
          office_address: "House Office Building",
          next_election: "",
          stats: {
            votesWithParty: 0,
            votesAgainstParty: 0,
            attendance: 0,
            billsIntroduced: 6,
            billsPassed: 0,
            amendmentsOffered: 0,
          },
          ideology: {},
          source: "congress_sync",
          source_system: "congress",
          source_id: "R001001",
          jurisdiction_type: "federal",
          state_code: "CA",
          session_id: null,
          synced_at: "2026-07-10T00:00:00.000Z",
          raw_payload: null,
          raw_member: {
            firstName: "Sample",
            lastName: "House Member",
            terms: {
              item: [{ chamber: "House of Representatives", district: 17 }],
            },
          },
        },
        {
          id: "unmatched-houseclerk-sample-house-member-ca",
          slug: "sample-house-member-unmatched",
          name: "Sample House Member",
          title: "US Legislator",
          party: "Democratic",
          state: "CA",
          district: null,
          biography: "Placeholder federal legislator record created from official roll-call vote data.",
          born: "",
          education: "",
          occupation: "Public official",
          website: "Not available from configured sources",
          office_phone: "Not available from configured sources",
          office_address: "Not available from configured sources",
          next_election: "Federal election calendar not connected",
          stats: {
            votesWithParty: 95,
            votesAgainstParty: 2,
            attendance: 98,
            billsIntroduced: 0,
            billsPassed: 0,
            amendmentsOffered: 0,
          },
          ideology: {},
          source: "congress_sync",
          source_system: "federal_votes",
          source_id: "unmatched-houseclerk-sample-house-member-ca",
          jurisdiction_type: "federal",
          state_code: "CA",
          session_id: null,
          synced_at: "2026-07-10T00:00:00.000Z",
          raw_payload: null,
          raw_member: null,
        },
      ];
    },
  });

  try {
    const politicians = await listStoredPoliticians();
    assert.equal(politicians.length, 1);
    assert.equal(politicians[0].title, "US Representative");
    assert.equal(politicians[0].district, "CA-17");
    assert.equal(politicians[0].stats.attendance, 98);
    assert.equal(politicians[0].stats.votesWithParty, 95);
  } finally {
    global.fetch = originalFetch;
  }
});

test("listStoredPoliticians preserves at-large federal house seats", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return [{
        id: "R009999",
        slug: "alaska-at-large-member",
        name: "At Large Member",
        title: "US Representative",
        party: "Republican",
        state: "Alaska",
        district: null,
        biography: "At-large House member.",
        born: "",
        education: "",
        occupation: "",
        website: "https://example.house.gov",
        office_phone: "202-225-2222",
        office_address: "House Office Building",
        next_election: "",
        stats: {
          votesWithParty: 90,
          votesAgainstParty: 5,
          attendance: 97,
          billsIntroduced: 3,
          billsPassed: 0,
          amendmentsOffered: 0,
        },
        ideology: {},
        source: "congress_sync",
        source_system: "congress",
        source_id: "R009999",
        jurisdiction_type: "federal",
        state_code: "AK",
        session_id: null,
        synced_at: "2026-07-10T00:00:00.000Z",
        raw_payload: null,
        raw_member: {
          firstName: "At",
          lastName: "Large Member",
          terms: {
            item: [{ chamber: "House of Representatives", district: 0 }],
          },
        },
      }];
    },
  });

  try {
    const politicians = await listStoredPoliticians();
    assert.equal(politicians.length, 1);
    assert.equal(politicians[0].title, "US Representative");
    assert.equal(politicians[0].district, "AK-AL");
    assert.equal(politicians[0].stats.attendance, 97);
  } finally {
    global.fetch = originalFetch;
  }
});

test("listStoredPoliticians restores at-large seats from array-shaped raw Congress terms", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return [{
        id: "B001323",
        slug: "nicholas-j-begich-iii",
        name: "Nicholas J. Begich III",
        title: "US Representative",
        party: "Republican",
        state: "Alaska",
        district: null,
        biography: "At-large House member.",
        born: "",
        education: "",
        occupation: "",
        website: "https://begich.house.gov",
        office_phone: "202-225-5765",
        office_address: "153 Cannon House Office Building",
        next_election: "",
        stats: {
          votesWithParty: 93,
          votesAgainstParty: 5,
          attendance: 99,
          billsIntroduced: 3,
          billsPassed: 0,
          amendmentsOffered: 0,
        },
        ideology: {},
        source: "congress_sync",
        source_system: "congress",
        source_id: "B001323",
        jurisdiction_type: "federal",
        state_code: "AK",
        session_id: null,
        synced_at: "2026-07-10T00:00:00.000Z",
        raw_payload: null,
        raw_member: {
          firstName: "Nicholas",
          lastName: "Begich",
          terms: [
            { chamber: "House of Representatives", memberType: "Representative", startYear: 2025 },
          ],
        },
      }];
    },
  });

  try {
    const politicians = await listStoredPoliticians();
    assert.equal(politicians.length, 1);
    assert.equal(politicians[0].title, "US Representative");
    assert.equal(politicians[0].district, "AK-AL");
    assert.equal(politicians[0].stats.attendance, 99);
  } finally {
    global.fetch = originalFetch;
  }
});

test("getPoliticiansData fills known vacant federal house seats with explicit placeholders", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";

  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/politicians")) {
      return {
        ok: true,
        async json() {
          return [
            {
              id: "G000605",
              slug: "adam-gray",
              name: "Adam Gray",
              title: "US Representative",
              party: "Democratic",
              state: "California",
              district: "CA-13",
              biography: "",
              born: "",
              education: "",
              occupation: "",
              website: "",
              office_phone: "",
              office_address: "",
              next_election: "",
              stats: {
                votesWithParty: 84,
                votesAgainstParty: 16,
                attendance: 96,
                billsIntroduced: 7,
                billsPassed: 0,
                amendmentsOffered: 0,
              },
              ideology: {},
              source: "congress_sync",
              source_system: "congress",
              source_id: "G000605",
              jurisdiction_type: "federal",
              state_code: "CA",
              session_id: null,
              synced_at: "2026-07-10T00:00:00.000Z",
              raw_payload: null,
              raw_member: {
                firstName: "Adam",
                lastName: "Gray",
              },
            },
          ];
        },
      };
    }

    if (url.includes("/rest/v1/bills")) {
      return { ok: true, async json() { return []; } };
    }

    if (url.includes("/rest/v1/sync_runs")) {
      return { ok: true, async json() { return []; } };
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  try {
    const result = await getPoliticiansData();
    const vacancies = result.politicians.filter((politician) => politician.party === "Vacant");
    const ca14 = vacancies.find((politician) => politician.district === "CA-14");
    const tx23 = vacancies.find((politician) => politician.district === "TX-23");

    assert.ok(ca14);
    assert.ok(tx23);
    assert.match(ca14.biography, /vacant since April 17, 2026/i);
    assert.match(tx23.biography, /Tony Gonzales/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("listStoredPoliticians does not classify a federal member as US House without a district seat", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return [
        {
          id: "SANDERS-SENATE",
          slug: "bernard-sanders",
          name: "Bernard Sanders",
          title: "US Senator",
          party: "Independent",
          state: "Vermont",
          district: null,
          biography: "US Senator from Vermont.",
          born: "",
          education: "",
          occupation: "",
          website: "https://www.sanders.senate.gov",
          office_phone: "202-224-5141",
          office_address: "Senate Office Building",
          next_election: "",
          stats: {
            votesWithParty: 0,
            votesAgainstParty: 0,
            attendance: 0,
            billsIntroduced: 5,
            billsPassed: 0,
            amendmentsOffered: 0,
          },
          ideology: {},
          source: "congress_sync",
          source_system: "congress",
          source_id: "SANDERS-SENATE",
          jurisdiction_type: "federal",
          state_code: "VT",
          session_id: null,
          synced_at: "2026-07-10T00:00:00.000Z",
          raw_payload: null,
          raw_member: {
            firstName: "Bernard",
            lastName: "Sanders",
          },
        },
        {
          id: "unmatched-houseclerk-bernard-sanders-vt",
          slug: "bernard-sanders-house-unmatched",
          name: "Bernard Sanders",
          title: "US Representative",
          party: "Independent",
          state: "VT",
          district: null,
          biography: "Placeholder federal legislator record created from official roll-call vote data.",
          born: "",
          education: "",
          occupation: "Public official",
          website: "Not available from configured sources",
          office_phone: "Not available from configured sources",
          office_address: "Not available from configured sources",
          next_election: "Federal election calendar not connected",
          stats: {
            votesWithParty: 96,
            votesAgainstParty: 2,
            attendance: 99,
            billsIntroduced: 0,
            billsPassed: 0,
            amendmentsOffered: 0,
          },
          ideology: {},
          source: "congress_sync",
          source_system: "federal_votes",
          source_id: "unmatched-houseclerk-bernard-sanders-vt",
          jurisdiction_type: "federal",
          state_code: "VT",
          session_id: null,
          synced_at: "2026-07-10T00:00:00.000Z",
          raw_payload: null,
          raw_member: null,
        },
      ];
    },
  });

  try {
    const politicians = await listStoredPoliticians();
    assert.equal(politicians.length, 1);
    assert.equal(politicians[0].title, "US Senator");
    assert.equal(politicians[0].state, "Vermont");
    assert.equal(politicians[0].stats.attendance, 99);
  } finally {
    global.fetch = originalFetch;
  }
});

test("listStoredPoliticians drops standalone federal placeholder offices that are not senator or representative seats", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return [{
        id: "unmatched-houseclerk-unknown-member-xx",
        slug: "unknown-member-unmatched",
        name: "Unknown Member",
        title: "US Legislator",
        party: "Unknown",
        state: "Unknown",
        district: null,
        biography: "Placeholder federal legislator record created from official roll-call vote data.",
        born: "",
        education: "",
        occupation: "Public official",
        website: "Not available from configured sources",
        office_phone: "Not available from configured sources",
        office_address: "Not available from configured sources",
        next_election: "Federal election calendar not connected",
        stats: {
          votesWithParty: 88,
          votesAgainstParty: 4,
          attendance: 92,
          billsIntroduced: 0,
          billsPassed: 0,
          amendmentsOffered: 0,
        },
        ideology: {},
        source: "congress_sync",
        source_system: "federal_votes",
        source_id: "unmatched-houseclerk-unknown-member-xx",
        jurisdiction_type: "federal",
        state_code: null,
        session_id: null,
        synced_at: "2026-07-10T00:00:00.000Z",
        raw_payload: null,
        raw_member: null,
      }];
    },
  });

  try {
    const politicians = await listStoredPoliticians();
    assert.equal(politicians.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchOpenStatesVotes reads roll calls embedded on bills", async () => {
  // OpenStates v3 has no /votes endpoint (it 404s). Votes are only returned as an embedded
  // resource on bills, via ?include=votes.
  process.env.POLITICA_OPENSTATES_API_KEY = "test-key";
  process.env.POLITICA_OPENSTATES_MIN_INTERVAL_MS = "0";

  const originalFetch = global.fetch;
  const requestedUrls = [];
  global.fetch = async (input) => {
    requestedUrls.push(String(input));
    return {
      ok: true,
      headers: { get: () => null },
      async json() {
        return {
          results: [{
            id: "ocd-bill/1",
            identifier: "HB 1",
            votes: [{
              id: "vote-1",
              motion_text: "On passage",
              result: "pass",
            }],
          }],
        };
      },
    };
  };

  try {
    const votes = await fetchOpenStatesVotes("ca");
    assert.equal(votes.length, 1);
    assert.equal(votes[0].id, "vote-1");
    assert.equal(votes[0].motion_text, "On passage");
    assert.equal(votes[0].bill.identifier, "HB 1");
    assert.match(requestedUrls[0], /\/bills\?/);
    assert.match(requestedUrls[0], /include=votes/);
  } finally {
    global.fetch = originalFetch;
    delete process.env.POLITICA_OPENSTATES_API_KEY;
    delete process.env.POLITICA_OPENSTATES_MIN_INTERVAL_MS;
  }
});
