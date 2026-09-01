const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const {
  formatCandidateName,
  formatParty,
  buildRaces,
  buildRaceId,
  generalElectionDate,
  daysUntil,
} = jiti("@/lib/elections");

test("formatParty prefers the short name, and spells out the minor parties", () => {
  // The three the shared party map resolves read better short.
  assert.equal(formatParty("REP", "REPUBLICAN PARTY"), "Republican");
  assert.equal(formatParty("DEM", "DEMOCRATIC PARTY"), "Democratic");
  assert.equal(formatParty("IND", "INDEPENDENT"), "Independent");

  // The other 15 in the 2026 feed have no mapping, so the spelled-out name beats the code.
  assert.equal(formatParty("LIB", "LIBERTARIAN PARTY"), "Libertarian Party");
  assert.equal(formatParty("DFL", "DEMOCRATIC-FARMER-LABOR"), "Democratic-Farmer-Labor");
  assert.equal(formatParty("NPA", "NO PARTY AFFILIATION"), "No Party Affiliation");

  // Some rows carry a code and no spelling at all, and one carries neither.
  assert.equal(formatParty("FWD", null), "FWD");
  assert.equal(formatParty(null, null), "Unknown");
});

test("formatCandidateName reorders the ordinary 'LAST, FIRST' shape", () => {
  assert.equal(formatCandidateName("SEWELL, TERRI A."), "Terri A. Sewell");
  assert.equal(formatCandidateName("KELLY, MARK"), "Mark Kelly");
  assert.equal(formatCandidateName("CRAWFORD, ERIC ALAN RICK"), "Eric Alan Rick Crawford");
});

test("formatCandidateName strips the honorifics candidates type into the field", () => {
  // 216 of the 2,460 live 2026 filings carry one of these.
  assert.equal(formatCandidateName("GOSAR, PAUL DR."), "Paul Gosar");
  assert.equal(formatCandidateName("WOMACK, STEPHEN A THE HON"), "Stephen A Womack");
  assert.equal(formatCandidateName("SCALISE, STEVE MR"), "Steve Scalise");
  assert.equal(formatCandidateName("BOOZMAN, SEN. JOHN"), "John Boozman");
  assert.equal(formatCandidateName("DESJARLAIS, SCOTT HON."), "Scott Desjarlais");
});

test("formatCandidateName moves a generational suffix after the surname", () => {
  assert.equal(formatCandidateName("CARL, JERRY LEE, JR"), "Jerry Lee Carl Jr");
  assert.equal(formatCandidateName("MCGUIRE, JOHN J. MR. III"), "John J. McGuire III");
});

test("formatCandidateName keeps Mc, apostrophe and hyphen names readable", () => {
  assert.equal(formatCandidateName("O'DONNELL, MARTY"), "Marty O'Donnell");
  assert.equal(formatCandidateName("D'ARRIGO, TONY C"), "Tony C D'Arrigo");
  assert.equal(formatCandidateName("MCCORMICK, RICHARD DEAN DR."), "Richard Dean McCormick");
  // "Mac" is left alone -- MACK and MACON are ordinary words, not MacK / MacOn.
  assert.equal(formatCandidateName("MACK, DANIEL"), "Daniel Mack");
});

test("formatCandidateName leaves a name it cannot parse in a readable order", () => {
  /*
   * Reordering these would invent a surname. "RAZACK, MD JD, NIZAM" has credentials in the middle
   * slot, and the last segment is not a suffix -- so it is title-cased and left alone rather than
   * rendered as some confident wrong name.
   */
  assert.equal(formatCandidateName("RAZACK, MD JD, NIZAM"), "Razack Md Jd Nizam");
  assert.equal(formatCandidateName("JOHN ARMENIAN"), "John Armenian");
  assert.equal(formatCandidateName(""), "Unknown");
  assert.equal(formatCandidateName(null), "Unknown");
});

test("formatCandidateName never returns an empty or partial name", () => {
  // Stripping honorifics must not empty a side: "MR., MR." is nonsense but must still render.
  for (const raw of ["MR., MR.", "DR, DR", ", ,", "HON, THE HON"]) {
    const formatted = formatCandidateName(raw);
    assert.ok(formatted.trim().length > 0, `${raw} produced an empty name`);
  }
});

test("buildRaceId separates a Senate race from the House seats in the same state", () => {
  assert.equal(buildRaceId("S", "CO", "00"), "s-co");
  assert.equal(buildRaceId("H", "CO", "03"), "h-co-03");
  // District spellings differ across the feed; the id must not.
  assert.equal(buildRaceId("H", "co", "3"), "h-co-03");
});

const ROWS = [
  {
    id: "H0AL01-2026", fec_candidate_id: "H0AL01", office: "H", state: "AL", district: "01",
    name: "CARL, JERRY LEE, JR", party: "REP", party_full: "REPUBLICAN PARTY",
    incumbent_challenge: "I", politician_id: "C001054", election_year: 2026,
  },
  {
    id: "H9AL01-2026", fec_candidate_id: "H9AL01", office: "H", state: "AL", district: "01",
    name: "ZZZ, ANNA", party: "DEM", party_full: "DEMOCRATIC PARTY",
    incumbent_challenge: "C", politician_id: null, election_year: 2026,
  },
  {
    id: "S0CO00-2026", fec_candidate_id: "S0CO00", office: "S", state: "CO", district: "00",
    name: "HICKENLOOPER, JOHN W.", party: "DEM", party_full: "DEMOCRATIC PARTY",
    incumbent_challenge: "I", politician_id: "H000273", election_year: 2026,
  },
  {
    id: "H0CO07-2026", fec_candidate_id: "H0CO07", office: "H", state: "CO", district: "07",
    name: "SMITH, ALEX", party: "REP", party_full: "REPUBLICAN PARTY",
    incumbent_challenge: "O", politician_id: null, election_year: 2026,
  },
];

test("buildRaces groups filings into the seat they contest", () => {
  const races = buildRaces(ROWS);
  assert.equal(races.length, 3);

  const alabama = races.find((race) => race.id === "h-al-01");
  assert.equal(alabama.candidates.length, 2);
  assert.equal(alabama.seat, "AL-1");
  assert.equal(alabama.officeLabel, "House");
});

test("buildRaces puts the incumbent first and names them", () => {
  const alabama = buildRaces(ROWS).find((race) => race.id === "h-al-01");
  assert.equal(alabama.candidates[0].standing, "incumbent");
  assert.equal(alabama.incumbent.name, "Jerry Lee Carl Jr");
  assert.equal(alabama.isOpenSeat, false);
});

test("buildRaces marks a seat with nobody defending it as open", () => {
  const colorado = buildRaces(ROWS).find((race) => race.id === "h-co-07");
  assert.equal(colorado.isOpenSeat, true);
  assert.equal(colorado.incumbent, undefined);
});

test("buildRaces orders the Senate race above the House seats in a state", () => {
  const colorado = buildRaces(ROWS).filter((race) => race.stateCode === "CO");
  assert.deepEqual(colorado.map((race) => race.id), ["s-co", "h-co-07"]);
});

test("a House filing with no district does not become an at-large seat", () => {
  /*
   * Two of the 2,460 live 2026 filings carry no district. Folding them into district 00 would
   * render as an at-large seat -- Maryland has none, so that would invent one. They get their own
   * key and say the district is not stated instead.
   */
  assert.equal(buildRaceId("H", "MD", null), "h-md-na");
  assert.equal(buildRaceId("H", "MD", ""), "h-md-na");
  // A real at-large seat still keys on its stated district.
  assert.equal(buildRaceId("H", "AK", "00"), "h-ak-00");

  const [race] = buildRaces([{
    id: "x", fec_candidate_id: "H0MD00", office: "H", state: "MD", district: null,
    name: "DYCHES, AUSTIN", party: "REP", party_full: "REPUBLICAN PARTY",
    incumbent_challenge: null, politician_id: null, election_year: 2026,
  }]);
  assert.equal(race.districtStated, false);
  assert.match(race.label, /district not stated/);

  // A Senate race ignores the district entirely, so a null there changes nothing.
  assert.equal(buildRaceId("S", "IL", null), buildRaceId("S", "IL", "00"));
});

test("buildRaces admits only federal offices", () => {
  /*
   * The FEC files House, Senate and President and nothing else, so there is no state legislature
   * data here to leak in. The guard is what keeps that true if a future source is ever merged in.
   */
  const withState = [...ROWS, { ...ROWS[0], id: "x", office: "SL", state: "AL", district: "004" }];
  const races = buildRaces(withState);
  assert.ok(races.every((race) => ["S", "H", "P"].includes(race.office)));
  assert.equal(races.length, 3);
});

test("generalElectionDate lands on the Tuesday after the first Monday in November", () => {
  // 2026: Nov 1 is a Sunday, first Monday the 2nd, election the 3rd.
  assert.equal(generalElectionDate(2026).toISOString().slice(0, 10), "2026-11-03");
  // 2028: Nov 1 is a Wednesday, first Monday the 6th, election the 7th.
  assert.equal(generalElectionDate(2028).toISOString().slice(0, 10), "2028-11-07");
  // A November starting on Monday must not skip to the second Monday.
  assert.equal(generalElectionDate(2027).toISOString().slice(0, 10), "2027-11-02");
});

test("daysUntil counts forward and gives up once the date has passed", () => {
  const election = new Date("2026-11-03T00:00:00Z");
  assert.equal(daysUntil(election, new Date("2026-11-01T00:00:00Z")), 2);
  assert.equal(daysUntil(election, new Date("2026-11-04T00:00:00Z")), null);
});
