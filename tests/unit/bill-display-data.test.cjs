const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { isConstitutionalAuthorityStatement } = jiti("@/lib/normalizers/legislation");
const { chanceOfBecomingLaw } = jiti("@/lib/bill-odds");

test("isConstitutionalAuthorityStatement recognizes the boilerplate, not real summaries", () => {
  assert.equal(
    isConstitutionalAuthorityStatement(
      "[Congressional Record Volume 171, Number 81 (Wednesday, May 14, 2025)] [House] From the Congressional Record Online",
    ),
    true,
  );
  assert.equal(
    isConstitutionalAuthorityStatement("By Mr. ALFORD: H.R. 3388. Congress has the power to enact this legislation pursuant to the following:"),
    true,
  );
  assert.equal(
    isConstitutionalAuthorityStatement("This bill requires states to provide such information as the Department of Justice may require."),
    false,
  );
  assert.equal(
    isConstitutionalAuthorityStatement("<pre>\n[Congressional Record Volume 172, Number 129]\n[House]\nCongress has the power\nto enact this legislation</pre>"),
    true,
  );
  assert.equal(isConstitutionalAuthorityStatement(null), false);
});

test("chanceOfBecomingLaw follows the bill's stage, and is certain only at the ends", () => {
  assert.equal(chanceOfBecomingLaw("Signed"), 100);
  assert.equal(chanceOfBecomingLaw("Failed"), 0);
  // The old formula gave the average bill in committee 45%.
  assert.ok(chanceOfBecomingLaw("In Committee") < 10);
  assert.ok(chanceOfBecomingLaw("Passed Chamber") > chanceOfBecomingLaw("On Floor"));
  assert.ok(chanceOfBecomingLaw("Sent to President") > chanceOfBecomingLaw("Passed Chamber"));
});

test("realText drops the placeholders the syncs store for missing data, and keeps real text", () => {
  const { realText, isPlaceholderText } = jiti("@/lib/utils");
  for (const placeholder of [
    "Not available from configured sources",
    "Chair roster not connected from Congress.gov yet",
    "Committee data pending full detail sync",
    "Official summary not provided by the source yet. Stored bill details will appear here as more metadata is synced.",
    "US Representative from Texas. Synced from Congress.gov via scheduled ingestion.",
    "Public official",
    "Election calendar not connected",
    "",
    null,
  ]) {
    assert.equal(realText(placeholder), "", String(placeholder));
    assert.equal(isPlaceholderText(placeholder), true);
  }
  assert.equal(realText("Judiciary Committee"), "Judiciary Committee");
  assert.equal(realText("  Attorney  "), "Attorney");
});

test("congressSessionLabel uses real ordinals", () => {
  const { congressSessionLabel } = jiti("@/lib/utils");
  assert.equal(congressSessionLabel(119), "119th Congress");
  assert.equal(congressSessionLabel(101), "101st Congress");
  assert.equal(congressSessionLabel("102"), "102nd Congress");
  assert.equal(congressSessionLabel(103), "103rd Congress");
  assert.equal(congressSessionLabel(111), "111th Congress");
  assert.equal(congressSessionLabel(112), "112th Congress");
  assert.equal(congressSessionLabel(121), "121st Congress");
  assert.equal(congressSessionLabel(undefined), "Unknown Congress");
});

test("excerptText and congressGovBillUrl", () => {
  const { excerptText, congressGovBillUrl } = jiti("@/lib/utils");
  assert.equal(excerptText("short"), "short");
  const long = "word ".repeat(100);
  const cut = excerptText(long, 50);
  assert.ok(cut.length <= 51 && cut.endsWith("…"));
  assert.equal(congressGovBillUrl("hr-1", 119, "summary"), "https://www.congress.gov/bill/119th-congress/house-bill/1/summary");
  assert.equal(congressGovBillUrl("sjres-7"), "https://www.congress.gov/bill/119th-congress/senate-joint-resolution/7");
  assert.equal(congressGovBillUrl("hconres-119-118"), undefined);
});
