const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const {
  parseAmountBand,
  normalizeOwner,
  normalizeTicker,
  normalizeTransactionType,
  parseDisclosureDate,
  isElectronicHouseDoc,
  parseHouseIndex,
  parseHouseTransactions,
  parseSenateTransactions,
  isSale,
} = jiti("@/lib/stock-disclosures");

test("amount bands keep both bounds and never collapse to a midpoint", () => {
  assert.deepEqual(parseAmountBand("$1,001 - $15,000"), { min: 1001, max: 15000 });
  assert.deepEqual(parseAmountBand("$15,001 - $50,000"), { min: 15001, max: 50000 });
  assert.deepEqual(parseAmountBand("$1,000,001 - $5,000,000"), { min: 1000001, max: 5000000 });
});

test("an open-ended top band has no upper bound rather than an invented one", () => {
  // Inventing a ceiling here would understate exactly the trades that matter most.
  assert.deepEqual(parseAmountBand("Over $50,000,000"), { min: 50000000, max: null });
  assert.deepEqual(parseAmountBand("$50,000,000 +"), { min: 50000000, max: null });
});

test("a missing amount is null, not zero", () => {
  // "$0" would be a claim the filing does not make.
  assert.deepEqual(parseAmountBand("--"), { min: null, max: null });
  assert.deepEqual(parseAmountBand(""), { min: null, max: null });
  assert.deepEqual(parseAmountBand(null), { min: null, max: null });
});

test("owner codes from both chambers land on the same values", () => {
  assert.equal(normalizeOwner("SP"), "spouse");
  assert.equal(normalizeOwner("Spouse"), "spouse");
  assert.equal(normalizeOwner("DC"), "child");
  assert.equal(normalizeOwner("Child"), "child");
  assert.equal(normalizeOwner("JT"), "joint");
  assert.equal(normalizeOwner("Joint"), "joint");
  assert.equal(normalizeOwner("--"), "self");
  assert.equal(normalizeOwner(null), "self");
});

test("transaction types normalize across the two chambers' spellings", () => {
  assert.equal(normalizeTransactionType("P"), "purchase");
  assert.equal(normalizeTransactionType("Purchase"), "purchase");
  assert.equal(normalizeTransactionType("S"), "sale");
  assert.equal(normalizeTransactionType("Sale (Full)"), "sale_full");
  assert.equal(normalizeTransactionType("Sale (Partial)"), "sale_partial");
  assert.equal(normalizeTransactionType("S (partial)"), "sale_partial");
  assert.equal(normalizeTransactionType("E"), "exchange");
  assert.equal(normalizeTransactionType("Exchange"), "exchange");
});

test("partial sales stay distinct from full ones", () => {
  // A partial sale leaves a position open; treating it as an exit misstates what happened.
  assert.notEqual(normalizeTransactionType("Sale (Partial)"), normalizeTransactionType("Sale (Full)"));
  assert.ok(isSale(normalizeTransactionType("Sale (Partial)")));
  assert.ok(isSale(normalizeTransactionType("S")));
  assert.ok(!isSale(normalizeTransactionType("P")));
});

test("a CUSIP is not returned as a ticker", () => {
  // 91282CJP7 is a Treasury note. Returned as a ticker it would be sent to the price API, come back
  // empty, and read as a lookup failure rather than a bond with no comparable market price.
  assert.equal(normalizeTicker("91282CJP7"), null);
  assert.equal(normalizeTicker("912797KJ5"), null);
  assert.equal(normalizeTicker("GSK"), "GSK");
  assert.equal(normalizeTicker("(ROL)"), "ROL");
  assert.equal(normalizeTicker("BRK.B"), "BRK.B");
  assert.equal(normalizeTicker("--"), null);
});

test("dates parse to ISO and reject malformed input", () => {
  assert.equal(parseDisclosureDate("07/28/2025"), "2025-07-28");
  assert.equal(parseDisclosureDate("1/8/2025"), "2025-01-08");
  assert.equal(parseDisclosureDate(""), null);
  assert.equal(parseDisclosureDate("not a date"), null);
  assert.equal(parseDisclosureDate("13/45/2025"), null);
});

test("House DocID prefix identifies an electronically filed document", () => {
  // Verified against twelve real filings across four years. This is what lets a scan be recorded
  // as such instead of being discovered later as an empty extraction.
  assert.equal(isElectronicHouseDoc("20032062"), true);
  assert.equal(isElectronicHouseDoc("20026537"), true);
  assert.equal(isElectronicHouseDoc("8218417"), false);
  assert.equal(isElectronicHouseDoc("9105731"), false);
});

test("the House index parses to rows and skips the header", () => {
  const tsv = [
    "Prefix\tLast\tFirst\tSuffix\tFilingType\tStateDst\tYear\tFilingDate\tDocID",
    "Hon.\tAderholt\tRobert B.\t\tP\tAL04\t2025\t9/10/2025\t20032062",
    "\tAbel\tWilliam P.\t\tC\tTX31\t2025\t10/12/2025\t10072640",
  ].join("\n");

  const rows = parseHouseIndex(tsv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].last, "Aderholt");
  assert.equal(rows[0].filingType, "P");
  assert.equal(rows[0].docId, "20032062");
  assert.equal(rows[0].filingDate, "2025-09-10");
  assert.equal(rows[0].stateDst, "AL04");
});

// Verbatim pdf.js output from House filing #20032062 (Rep. Aderholt).
const ADERHOLT = `Filing ID #20032062
Name: Hon. Robert B. Aderholt
Status: Member
State/District: AL04
ID Owner Asset Transaction Date Notification Amount Cap.
Type Date Gains >
$200?
GSK plc American Depositary Shares S 07/28/2025 08/11/2025 $1,001 - $15,000
(GSK) [ST]
F      S     : New
* For the complete list of asset type abbreviations, please visit https://fd.house.gov/reference/asset-type-codes.aspx.`;

test("a House transaction is read across the line wrap that splits its row", () => {
  const rows = parseHouseTransactions(ADERHOLT);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ticker, "GSK");
  assert.equal(rows[0].transactionType, "sale");
  assert.equal(rows[0].transactionDate, "2025-07-28");
  assert.equal(rows[0].filedOn, "2025-08-11");
  assert.equal(rows[0].amountMin, 1001);
  assert.equal(rows[0].amountMax, 15000);
  assert.equal(rows[0].owner, "self");
  assert.equal(rows[0].assetType, "ST");
});

// Verbatim from filing #20026537 (Rep. Allen): four transactions, spouse-owned, and the band's
// upper bound wrapped onto the following line.
const ALLEN = `ID Owner Asset Transaction Date Notification Amount Cap.
Type Date Gains >
$200?
SP Rollins, Inc. Common Stock (ROL) P 12/12/2024 01/08/2025 $15,001 -
[ST] $50,000
F      S     : New
S          O : R.W. Allen & Associates, Inc. > RWA&A - Securities
SP US TREASU NOTE 4.375% DUE P 12/03/2024 01/08/2025 $100,001 -
12/15/26 (91282CJP7) [GS] $250,000
F      S     : New
S          O : R.W. Allen & Associates, Inc. > RWA&A - Securities
US TREASURY BILL DUE 03/20/25 P 12/03/2024 01/08/2024 $15,001 -
(912797KJ5) [GS] $50,000
F      S     : New
S          O : SCH1
* For the complete list of asset type abbreviations, please visit`;

test("every transaction in a multi-row House filing is found", () => {
  const rows = parseHouseTransactions(ALLEN);
  assert.equal(rows.length, 3);
});

test("a band whose upper bound wrapped onto the next line is still complete", () => {
  // "$15,001 -" ends the anchor line and "$50,000" opens the next. Reading only the anchor would
  // store a band of $15,001-$15,001.
  const [rollins] = parseHouseTransactions(ALLEN);
  assert.equal(rollins.amountMin, 15001);
  assert.equal(rollins.amountMax, 50000);
  assert.equal(rollins.ticker, "ROL");
  assert.equal(rollins.owner, "spouse");
  assert.equal(rollins.transactionType, "purchase");
});

test("a Treasury note's CUSIP does not become its ticker", () => {
  const rows = parseHouseTransactions(ALLEN);
  const treasury = rows[1];
  assert.equal(treasury.ticker, null);
  assert.equal(treasury.assetType, "GS");
  assert.equal(treasury.amountMin, 100001);
  assert.equal(treasury.amountMax, 250000);
});

// Verbatim from filing #20034201 (Rep. Alford), after NUL stripping. The per-transaction labels
// are set in small caps and reduce to bare capitals plus a colon, and the description line quotes
// per-share prices.
const ALFORD = `ID Owner Asset Transaction Date Notification Amount Cap.
Type Date Gains >
$200?
Amazon.com, Inc. - Common Stock S (partial) 03/16/2026 03/16/2026 $1,001 - $15,000
(AMZN) [ST]
F S: New
S O: Putnam Investments
D: The full transaction included the following sales: T – 37.426 shares sold @ $27.645/share BRK/B – 3 shares
sold @ $493.42/share SPY – 8.318 shares sold @ $670.024/share
Apple Inc. - Common Stock (AAPL) S (partial) 03/16/2026 03/16/2026 $1,001 - $15,000
[ST]
F S: New`;

test("a description line's per-share prices never become the disclosed amount", () => {
  // This shipped as $27-$15,000 on a filing that discloses $1,001-$15,000: the label lines were
  // built from NUL bytes rather than spaces, so nothing matched them as a block end and the
  // description's "@ $27.645/share" was read as the band's lower bound.
  const rows = parseHouseTransactions(ALFORD);
  assert.equal(rows.length, 2);

  for (const row of rows) {
    assert.equal(row.amountMin, 1001);
    assert.equal(row.amountMax, 15000);
  }
});

test("label lines are excluded from the asset name", () => {
  const [amazon] = parseHouseTransactions(ALFORD);
  assert.equal(amazon.ticker, "AMZN");
  assert.ok(!/Putnam|New|shares/.test(amazon.assetName), `leaked label text: ${amazon.assetName}`);
});

// Verbatim from filing #20023082 (Rep. Allen), an amended report covering six years of back
// transactions. Amended rows carry the original transaction's id ahead of the owner code.
const AMENDED = `ID Owner Asset Transaction Date Notification Amount Cap.
Type Date Gains >
$200?
2000086356 SP 3M Company (MMM) [ST] S 05/14/2020 05/20/2020 $15,001 -
$50,000
F S: Amended
S O: R.W. Allen & Associates, Inc. > RWA&A - Securities
SP 3M Company (MMM) [ST] S 05/14/2020 06/05/2020 $1,001 - $15,000
F S: New`;

test("an amended row's leading transaction id does not hide the owner", () => {
  // The id sits before "SP", so without allowing for it the owner group cannot match and every
  // spouse-owned trade on an amended report is attributed to the member.
  const rows = parseHouseTransactions(AMENDED);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].owner, "spouse");
  assert.equal(rows[1].owner, "spouse");
  assert.equal(rows[0].ticker, "MMM");
  assert.equal(rows[0].amountMin, 15001);
  assert.equal(rows[0].amountMax, 50000);
  assert.equal(rows[0].transactionDate, "2020-05-14");
});

test("the transaction id is not left in the asset name", () => {
  const [first] = parseHouseTransactions(AMENDED);
  assert.ok(!/2000086356/.test(first.assetName), `id leaked into asset name: ${first.assetName}`);
});

test("a leading symbol is read when the filer puts it before the name", () => {
  // "DIA - State Street SPDR Dow Jones" carries its symbol first rather than in parentheses.
  const rows = parseHouseTransactions(
    "DIA - State Street SPDR Dow Jones S (partial) 03/16/2026 03/16/2026 $1,001 - $15,000\nF S: New",
  );
  assert.equal(rows[0].ticker, "DIA");
});

test("an asset with no symbol stays unresolved rather than guessed", () => {
  // A wrong ticker sends the trade to the price API and scores it against the wrong company, which
  // is worse than reporting it as unscored.
  const rows = parseHouseTransactions(
    "US Treasury Bill 912797PD3 [GS] P 07/10/2025 08/07/2025 $50,001 -\n$100,000\nF S: New",
  );
  assert.equal(rows[0].ticker, null);
  assert.equal(rows[0].amountMin, 50001);
  assert.equal(rows[0].amountMax, 100000);
});

// Verbatim structure of an electronic Senate report (Sen. Fetterman, 08/10/2026).
const SENATE = `<table class="table">
<thead><tr><th>#</th><th>Transaction Date</th><th>Owner</th><th>Ticker</th><th>Asset Name</th><th>Asset Type</th><th>Type</th><th>Amount</th><th>Comment</th></tr></thead>
<tbody>
<tr><td>1</td><td>07/24/2026</td><td>Child</td><td>--</td><td>Freeport McMoran Rate/Coupon: 9.5%</td><td>Corporate Bond</td><td>Sale (Full)</td><td>$1,001 - $15,000</td><td>--</td></tr>
<tr><td>2</td><td>07/07/2026</td><td>Self</td><td>AAPL</td><td>Apple Inc. Common Stock</td><td>Stock</td><td>Purchase</td><td>$50,001 - $100,000</td><td>Held in trust</td></tr>
</tbody></table>`;

test("Senate reports parse straight from the HTML table", () => {
  const rows = parseSenateTransactions(SENATE);
  assert.equal(rows.length, 2);

  assert.equal(rows[0].owner, "child");
  assert.equal(rows[0].ticker, null);
  assert.equal(rows[0].transactionType, "sale_full");
  assert.equal(rows[0].transactionDate, "2026-07-24");
  assert.equal(rows[0].amountMax, 15000);

  assert.equal(rows[1].ticker, "AAPL");
  assert.equal(rows[1].transactionType, "purchase");
  assert.equal(rows[1].amountMin, 50001);
  assert.equal(rows[1].comment, "Held in trust");
});

test("a Senate paper filing yields nothing rather than throwing", () => {
  // Paper filings render as an embedded PDF image with no table. The caller records these as
  // `scanned`; they must not look like a member with no transactions.
  assert.deepEqual(parseSenateTransactions("<div>no table here</div>"), []);
  assert.deepEqual(parseSenateTransactions(""), []);
});
