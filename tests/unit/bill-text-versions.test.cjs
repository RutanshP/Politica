const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const {
  billTextSourceForVersion,
  hasReadableBillText,
  orderBillTextVersions,
  resolveBillTextSource,
} = jiti("@/lib/adapters/bill-text");

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

test("hasReadableBillText separates renderable versions from link-only ones", () => {
  assert.equal(hasReadableBillText(ENROLLED), true);
  assert.equal(hasReadableBillText(version("v6", "Public Law", "Jul 10, 2026")), false);
});

test("orderBillTextVersions puts the newest version first", () => {
  const ordered = orderBillTextVersions([INTRODUCED, ENROLLED, REPORTED]);
  assert.deepEqual(ordered.map((item) => item.id), ["v3", "v2", "v1"]);
});

test("orderBillTextVersions keeps same-day versions in reverse stored order", () => {
  // Several versions are routinely published on one day, so the date alone cannot order them.
  const first = version("a", "Engrossed in House", "Apr 1, 2026", "https://x/a.xml");
  const second = version("b", "Engrossed Amendment Senate", "Apr 1, 2026", "https://x/b.xml");
  assert.deepEqual(orderBillTextVersions([first, second]).map((item) => item.id), ["b", "a"]);
});
