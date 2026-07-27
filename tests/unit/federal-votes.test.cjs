const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const {
  normalizeFederalBillId,
  normalizeFederalVoteMatchKey,
  parseHouseRollCallVoteXml,
  parseSenateRollCallVoteXml,
} = jiti("@/lib/adapters/federal-votes");

test("normalizeFederalBillId converts congressional document labels into stored bill ids", () => {
  assert.equal(normalizeFederalBillId("H.R. 144"), "hr-144");
  assert.equal(normalizeFederalBillId("S. 5"), "s-5");
  assert.equal(normalizeFederalBillId("H. J. Res. 32"), "hjres-32");
  assert.equal(normalizeFederalBillId("QUORUM"), null);
});

test("normalizeFederalVoteMatchKey normalizes names for state and party matching", () => {
  assert.equal(
    normalizeFederalVoteMatchKey({
      name: "Schiff, Adam B.",
      state: "CA",
      party: "D",
    }),
    "adam b schiff|CA|D",
  );
});

test("parseHouseRollCallVoteXml parses official House vote XML into a federal vote record", () => {
  const vote = parseHouseRollCallVoteXml(`
    <rollcall-vote>
      <vote-metadata>
        <congress>119</congress>
        <session>1st</session>
        <rollcall-num>44</rollcall-num>
        <legis-num>H.R. 144</legis-num>
        <vote-question>On Passage</vote-question>
        <vote-result>Passed</vote-result>
        <action-date>16-Jan-2025</action-date>
        <totals-by-vote>
          <yea-total>218</yea-total>
          <nay-total>206</nay-total>
          <present-total>1</present-total>
          <not-voting-total>10</not-voting-total>
        </totals-by-vote>
      </vote-metadata>
      <vote-data>
        <recorded-vote>
          <legislator name-id="S001150" party="D" state="CA">Schiff</legislator>
          <vote>Aye</vote>
        </recorded-vote>
      </vote-data>
    </rollcall-vote>
  `);

  assert.equal(vote.id, "house-119-1-0044");
  assert.equal(vote.billId, "hr-144");
  assert.equal(vote.yea, 218);
  assert.equal(vote.positions[0].politicianId, "S001150");
  assert.equal(vote.positions[0].vote, "Yea");
});

test("parseHouseRollCallVoteXml prefers chamber totals over nested subtotals", () => {
  const vote = parseHouseRollCallVoteXml(`
    <rollcall-vote>
      <vote-metadata>
        <congress>119</congress>
        <session>1st</session>
        <rollcall-num>203</rollcall-num>
        <legis-num>H.R. 2035</legis-num>
        <vote-question>On Passage</vote-question>
        <vote-result>Passed</vote-result>
        <action-date>09-Jun-2025</action-date>
        <totals-by-party-header>
          <totals-by-vote>
            <yea-total>186</yea-total>
            <nay-total>12</nay-total>
            <present-total>0</present-total>
            <not-voting-total>21</not-voting-total>
          </totals-by-vote>
        </totals-by-party-header>
        <totals-by-vote>
          <yea-total>218</yea-total>
          <nay-total>206</nay-total>
          <present-total>1</present-total>
          <not-voting-total>10</not-voting-total>
        </totals-by-vote>
      </vote-metadata>
      <vote-data>
        <recorded-vote>
          <legislator name-id="A000001" party="D" state="CA">Alpha</legislator>
          <vote>Aye</vote>
        </recorded-vote>
      </vote-data>
    </rollcall-vote>
  `);

  assert.equal(vote.yea, 218);
  assert.equal(vote.nay, 206);
  assert.equal(vote.notVoting, 10);
});

test("parseSenateRollCallVoteXml parses official Senate vote XML into a federal vote record", () => {
  const vote = parseSenateRollCallVoteXml(`
    <roll_call_vote>
      <congress>119</congress>
      <session>1</session>
      <vote_number>1</vote_number>
      <vote_date>January 9, 2025, 02:54 PM</vote_date>
      <vote_title>Motion to Invoke Cloture: Motion to Proceed to S. 5</vote_title>
      <vote_result>Cloture on the Motion to Proceed Agreed to</vote_result>
      <document>
        <document_type>S.</document_type>
        <document_number>5</document_number>
      </document>
      <count>
        <yeas>84</yeas>
        <nays>9</nays>
        <present></present>
        <absent>6</absent>
      </count>
      <members>
        <member>
          <first_name>Adam</first_name>
          <last_name>Schiff</last_name>
          <party>D</party>
          <state>CA</state>
          <vote_cast>Not Voting</vote_cast>
          <lis_member_id>S427</lis_member_id>
        </member>
      </members>
    </roll_call_vote>
  `);

  assert.equal(vote.id, "senate-119-1-00001");
  assert.equal(vote.billId, "s-5");
  assert.equal(vote.notVoting, 6);
  assert.equal(vote.positions[0].externalId, "S427");
  assert.equal(vote.positions[0].vote, "Not Voting");
});

/*
 * The real Senate feed carries <vote_result_text> ahead of <vote_result>, and a tag pattern that
 * let the name match as a prefix opened on the _text tag and ran to the real closing tag -- which
 * put raw <question>/<vote_title>/<majority_requirement> markup on screen for 797 stored votes.
 */
test("parseSenateRollCallVoteXml does not read a longer tag that starts with the requested name", () => {
  const vote = parseSenateRollCallVoteXml(`
    <roll_call_vote>
      <congress>119</congress>
      <congress_year>2025</congress_year>
      <session>1</session>
      <vote_number>5</vote_number>
      <vote_date>January 9, 2025, 02:54 PM</vote_date>
      <vote_result_text>Cloture Motion Agreed to (61-35, 3/5 majority required)</vote_result_text>
      <question>On the Cloture Motion</question>
      <vote_title>Motion to Invoke Cloture: S. 5</vote_title>
      <majority_requirement>3/5</majority_requirement>
      <vote_result>Cloture Motion Agreed to</vote_result>
      <document>
        <document_type>S.</document_type>
        <document_number>5</document_number>
      </document>
      <count>
        <yeas>61</yeas>
        <nays>35</nays>
        <present></present>
        <absent>4</absent>
      </count>
      <members>
        <member>
          <member_full>Schiff (D-CA)</member_full>
          <first_name>Adam</first_name>
          <last_name>Schiff</last_name>
          <party>D</party>
          <state>CA</state>
          <vote_cast>Yea</vote_cast>
          <lis_member_id>S427</lis_member_id>
        </member>
      </members>
    </roll_call_vote>
  `);

  assert.equal(vote.result, "Cloture Motion Agreed to");
  assert.ok(!vote.result.includes("<"), "result must not carry raw markup");
  // congress must not be read from the <congress_year> that follows it.
  assert.equal(vote.id, "senate-119-1-00005");
  assert.equal(vote.title, "Motion to Invoke Cloture: S. 5");
  assert.equal(vote.yea, 61);
  // <members> must not be mistaken for a <member> block, nor <member_full> for <member>.
  assert.equal(vote.positions.length, 1);
  assert.equal(vote.positions[0].name, "Adam Schiff");
  assert.equal(vote.positions[0].vote, "Yea");
});
