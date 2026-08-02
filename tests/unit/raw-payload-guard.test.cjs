const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Guards the storage reclaim in 023.
 *
 * `raw_payload` has now been drained three separate times -- votes in 018, bills in 022,
 * vote_positions and four other tables in 023 -- because each fix corrected the writers it knew
 * about and a later sync path reintroduced the column somewhere else. The vote_positions miss cost
 * 83MB and took the database from 300MB to 672MB.
 *
 * Nothing in the type system prevents the next one: `raw_payload: unknown` accepts any value, so
 * writing the whole source blob back is a one-line change that typechecks, passes review as
 * "keeping the raw record", and shows up weeks later as a storage alert. This test is the check
 * that would have caught it.
 *
 * If this fails, you have added a source blob to a synced table. That is not automatically wrong --
 * but confirm nothing merely reads it as `rawAvailable: Boolean(row.raw_payload)`, which is a badge
 * no component renders, and add it to ALLOWED below with the reason.
 */

const ROOT = path.join(__dirname, "..", "..");

// Every module that builds rows for a table the syncs write in bulk.
const WRITER_FILES = [
  "lib/server/legislation-sync.ts",
  "lib/server/state-sync.ts",
  "lib/server/state-vote-sync.ts",
  "lib/server/election-candidates-sync.ts",
  "lib/normalizers/legislation.ts",
  "lib/normalizers/politicians.ts",
];

/*
 * The one deliberate exception. buildFederalCommitteeMembershipRows records a synthesized
 * {committeeId, politicianId, role, matchedBy} provenance object rather than a source document --
 * matchedBy is stored nowhere else, and committee_members is 768kB in total.
 */
const ALLOWED = [
  { file: "lib/server/legislation-sync.ts", value: "{" },
];

function findRawPayloadWrites(relativePath) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");

  return source
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter((entry) => /^raw_payload:/.test(entry.line))
    .map((entry) => ({
      file: relativePath,
      lineNumber: entry.lineNumber,
      // The assigned expression, minus the trailing comma.
      value: entry.line.replace(/^raw_payload:\s*/, "").replace(/,$/, ""),
    }))
    .filter((entry) => entry.value !== "null");
}

test("no sync writer stores a raw_payload source blob", () => {
  const violations = WRITER_FILES.flatMap(findRawPayloadWrites).filter(
    (entry) => !ALLOWED.some((allowed) => allowed.file === entry.file && allowed.value === entry.value),
  );

  assert.deepEqual(
    violations,
    [],
    `raw_payload is being written as a source blob again:\n${violations
      .map((entry) => `  ${entry.file}:${entry.lineNumber} -> ${entry.value}`)
      .join("\n")}\nSee supabase/sql/023_politica_storage_reclaim.sql.`,
  );
});

test("the raw_payload guard is actually looking at the writers", () => {
  // A rename or a moved file would otherwise make the test above vacuously pass.
  for (const file of WRITER_FILES) {
    assert.ok(
      fs.existsSync(path.join(ROOT, file)),
      `${file} no longer exists -- update WRITER_FILES or the guard stops covering it`,
    );
  }

  const allWrites = WRITER_FILES.flatMap((file) => {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    return source.split(/\r?\n/).filter((line) => /^\s*raw_payload:/.test(line));
  });

  assert.ok(allWrites.length > 0, "found no raw_payload assignments at all -- the guard is not matching");
});
