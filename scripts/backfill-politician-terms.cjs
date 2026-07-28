/*
 * Populates politicians.official_terms from unitedstates/congress-legislators.
 *
 * The roster sync does this going forward, but it only touches members whose Congress.gov record
 * changed, so without a backfill most members would wait indefinitely. Requires migration 021.
 *
 *   node scripts/backfill-politician-terms.cjs            # dry run
 *   node scripts/backfill-politician-terms.cjs --apply    # write
 */
const fs = require("node:fs");
const path = require("node:path");

const jiti = require("../tests/support/jiti.cjs");
const { fetchCongressLegislatorsTerms } = jiti("@/lib/adapters/congress-legislators");

const APPLY = process.argv.includes("--apply");
const ROOT = path.resolve(__dirname, "..");
const PAGE = 1000;

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY;
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function main() {
  const termsByBioguide = await fetchCongressLegislatorsTerms();
  console.log(`congress-legislators: ${termsByBioguide.size} sitting members`);

  const politicians = [];
  for (let offset = 0; ; offset += PAGE) {
    const response = await fetch(
      `${URL_BASE}/rest/v1/politicians?select=id,name&jurisdiction_type=eq.federal&limit=${PAGE}&offset=${offset}`,
      { headers },
    );
    if (!response.ok) throw new Error(`read failed: ${response.status} ${await response.text()}`);
    const page = await response.json();
    politicians.push(...page);
    if (page.length < PAGE) break;
  }
  console.log(`federal politicians stored: ${politicians.length}`);

  const matched = politicians.filter((row) => termsByBioguide.has(row.id));
  console.log(`matched by bioguide: ${matched.length}`);
  console.log(`unmatched (former members, outside the current file): ${politicians.length - matched.length}`);

  if (matched.length > 0) {
    const sample = matched[0];
    console.log(`\nsample -- ${sample.name}:`);
    for (const term of termsByBioguide.get(sample.id).slice(-3)) {
      console.log("   ", JSON.stringify(term));
    }
  }

  if (!APPLY) {
    console.log("\nDRY RUN -- pass --apply to write.");
    return;
  }

  let done = 0;
  let failed = 0;
  for (const row of matched) {
    const response = await fetch(`${URL_BASE}/rest/v1/politicians?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ official_terms: termsByBioguide.get(row.id) }),
    });
    if (response.ok) done += 1;
    else {
      failed += 1;
      if (failed <= 3) console.log(`FAILED ${row.id}: ${response.status} ${await response.text()}`);
    }
  }
  console.log(`\npatched: ${done}, failed: ${failed}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
