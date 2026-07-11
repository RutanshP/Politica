const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { buildUpdatedPoliticianRowsFromVotePositions } = jiti("@/lib/server/vote-stats");
const { mergeCommitteeMembershipIds } = jiti("@/lib/supabase/committees");
const { normalizeCongressMemberToPolitician, mapPoliticianToRow } = jiti("@/lib/normalizers/politicians");

test("buildUpdatedPoliticianRowsFromVotePositions recomputes attendance and party alignment", () => {
  const rows = buildUpdatedPoliticianRowsFromVotePositions(
    [{
      id: "member-1",
      slug: "member-1",
      name: "Ada Lovelace",
      title: "State Senator",
      party: "Democratic",
      state: "CA",
      district: null,
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
      source: "openstates_sync",
      source_system: "openstates",
      source_id: "member-1",
      jurisdiction_type: "state",
      state_code: "CA",
      session_id: null,
      synced_at: "2026-07-10T00:00:00.000Z",
      raw_member: {},
    }],
    [
      { vote_id: "vote-1", politician_id: "member-1", name: "Ada Lovelace", party: "D", state: "CA", vote: "Yea", source_system: "openstates", source_id: "1", synced_at: "2026-07-10T00:00:00.000Z", raw_payload: {} },
      { vote_id: "vote-1", politician_id: "member-2", name: "Bob", party: "D", state: "CA", vote: "Yea", source_system: "openstates", source_id: "2", synced_at: "2026-07-10T00:00:00.000Z", raw_payload: {} },
      { vote_id: "vote-2", politician_id: "member-1", name: "Ada Lovelace", party: "D", state: "CA", vote: "Not Voting", source_system: "openstates", source_id: "3", synced_at: "2026-07-10T00:00:00.000Z", raw_payload: {} },
      { vote_id: "vote-2", politician_id: "member-2", name: "Bob", party: "D", state: "CA", vote: "Nay", source_system: "openstates", source_id: "4", synced_at: "2026-07-10T00:00:00.000Z", raw_payload: {} },
    ],
  );

  assert.equal(rows[0].stats.attendance, 50);
  assert.equal(rows[0].stats.votesWithParty, 100);
  assert.equal(rows[0].stats.votesAgainstParty, 0);
});

test("mergeCommitteeMembershipIds applies roster ids onto committee records", () => {
  const committees = mergeCommitteeMembershipIds(
    [{
      id: "committee-1",
      slug: "committee-1",
      name: "Rules Committee",
      chamber: "House",
      jurisdiction: "Rules",
      chair: "",
      rankingMember: "",
      description: "",
      hearing: "",
      activeBillIds: [],
      memberIds: [],
    }],
    [
      { committeeId: "committee-1", politicianId: "member-1", role: "chair", sortOrder: 0 },
      { committeeId: "committee-1", politicianId: "member-2", role: "member", sortOrder: 1 },
    ],
  );

  assert.deepEqual(committees[0].memberIds, ["member-1", "member-2"]);
});

test("normalizeCongressMemberToPolitician prefers the latest term for chamber and district", () => {
  const politician = normalizeCongressMemberToPolitician(
    {
      bioguideId: "X000001",
      firstName: "Lisa",
      lastName: "Blunt Rochester",
      state: "DE",
      terms: {
        item: [
          { chamber: "House of Representatives", district: 0, startYear: 2017, endYear: 2024 },
          { chamber: "Senate", startYear: 2025, endYear: 2030 },
        ],
      },
    },
    undefined,
  );

  assert.equal(politician.title, "US Senator");
  assert.equal(politician.district, undefined);
  assert.equal(politician.state, "DE");
});

test("mapPoliticianToRow stores a normalized federal state code", () => {
  const row = mapPoliticianToRow({
    id: "X000002",
    slug: "becca-balint",
    name: "Becca Balint",
    title: "US Representative",
    party: "Democratic",
    state: "Vermont",
    district: "VT-AL",
    biography: "",
    born: "",
    education: "",
    occupation: "",
    website: "",
    officePhone: "",
    officeAddress: "",
    nextElection: "",
    jurisdictionType: "federal",
    stats: {
      votesWithParty: 0,
      votesAgainstParty: 0,
      attendance: 0,
      billsIntroduced: 0,
      billsPassed: 0,
      amendmentsOffered: 0,
    },
    ideology: {},
    sourceMetadata: {
      sourceSystem: "congress",
      sourceId: "X000002",
      rawAvailable: true,
    },
  }, {});

  assert.equal(row.state_code, "VT");
});
