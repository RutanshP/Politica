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
