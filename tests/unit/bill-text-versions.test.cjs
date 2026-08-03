const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { billTextSourceForVersion, resolveBillTextSource } = jiti("@/lib/adapters/bill-text");

function version(id, label, date, xmlUrl, sourceUrl) {
  return {
    id,
    label,
    date,
    sourceUrl,
    formats: xmlUrl ? [{ type: "Formatted XML", url: xmlUrl }] : [],
  };
}

// Verbatim shape from H.R. 6644, which stores nine versions.
const INTRODUCED = version("v1", "Introduced in House", "Jan 8, 2026", "https://www.congress.gov/119/bills/hr6644/BILLS-119hr6644ih.xml");
const REPORTED = version("v2", "Reported in House", "Mar 2, 2026", "https://www.congress.gov/119/bills/hr6644/BILLS-119hr6644rh.xml");
const ENROLLED = version("v3", "Enrolled Bill", "Jul 1, 2026", "https://www.congress.gov/119/bills/hr6644/BILLS-119hr6644enr.xml");

test("resolveBillTextSource returns the requested version, not the default pick", () => {
  // The tab used to render only pickBillTextSource's choice, so eight of nine versions were
  // unreachable even though each has its own document.
  const resolved = resolveBillTextSource([INTRODUCED, REPORTED, ENROLLED], "v1");
  assert.equal(resolved.version.id, "v1");
  assert.ok(resolved.url.endsWith("ih.xml"));
});

test("resolveBillTextSource falls back to the default pick without a request", () => {
  // Enrolled outranks Introduced and Reported, and that default is unchanged.
  const resolved = resolveBillTextSource([INTRODUCED, REPORTED, ENROLLED]);
  assert.equal(resolved.version.id, "v3");
});

test("resolveBillTextSource falls back rather than failing on an unknown version", () => {
  // A stale or hand-edited ?version= should still land on readable text.
  const resolved = resolveBillTextSource([INTRODUCED, ENROLLED], "does-not-exist");
  assert.equal(resolved.version.id, "v3");
});

test("resolveBillTextSource falls back when the requested version has no readable text", () => {
  const textless = version("v4", "Public Law", "Jul 10, 2026", undefined, undefined);
  const resolved = resolveBillTextSource([INTRODUCED, textless], "v4");
  assert.equal(resolved.version.id, "v1");
});

test("billTextSourceForVersion derives the xml url from an .htm source", () => {
  const htmOnly = version("v5", "Engrossed in House", "Apr 1, 2026", undefined, "https://www.congress.gov/119/bills/hr6644/BILLS-119hr6644eh.htm");
  assert.equal(
    billTextSourceForVersion(htmOnly).url,
    "https://www.congress.gov/119/bills/hr6644/BILLS-119hr6644eh.xml",
  );
});

test("billTextSourceForVersion returns nothing for a version with no readable document", () => {
  // "Public Law" ships only USLM, which this does not render, so the caller falls back.
  assert.equal(billTextSourceForVersion(version("v6", "Public Law", "Jul 10, 2026")), null);
});

/*
 * Ordering coverage moved to tests/unit/bill-versions.test.cjs when the standalone Text tab folded
 * into Version Details: bill texts are now ordered together with amendments in one list, so
 * ordering them in isolation no longer describes anything the app does.
 */
