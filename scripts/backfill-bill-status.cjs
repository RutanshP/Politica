/*
 * Re-derives bills.status from each bill's stored action history.
 *
 * Status used to be read off a single latest action, so a bill regressed to "Introduced" the
 * moment something unrecognized happened to it (see deriveBillStatus). Stored rows still carry
 * those wrong values; this recomputes them in place. Actions are already in the database, so
 * nothing is re-fetched from Congress.gov.
 *
 *   node scripts/backfill-bill-status.cjs            # dry run
 *   node scripts/backfill-bill-status.cjs --apply    # write
 */
const fs = require("node:fs");
const path = require("node:path");

const jiti = require("../tests/support/jiti.cjs");
// The app's own derivation -- imported rather than reimplemented, so the backfill and the
// running code can never disagree about what a status means.
const { deriveBillStatus } = jiti("@/lib/normalizers/bills");

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

async function readAll(pathname, select, label, filter = "") {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const response = await fetch(
      `${URL_BASE}/rest/v1/${pathname}?select=${select}&limit=${PAGE}&offset=${offset}${filter}`,
      { headers },
    );
    if (!response.ok) throw new Error(`${label} read failed: ${response.status} ${await response.text()}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  console.log(`${label}: ${rows.length}`);
  return rows;
}

async function main() {
  /*
   * Federal only. State bills come from OpenStates and are classified by
   * normalizeOpenStatesStatus (lib/server/state-sync.ts), which speaks a different vocabulary --
   * California records enactment as "Chaptered by Secretary of State", which deriveBillStatus
   * has no reason to know. Running the federal derivation over them downgraded 36 enacted laws
   * to "Introduced".
   */
  const bills = await readAll(
    "bills",
    "id,status,latest_action",
    "federal bills",
    "&jurisdiction_type=eq.federal",
  );
  const actions = await readAll("bill_actions", "bill_id,sort_order,detail", "actions");

  const actionsByBill = new Map();
  for (const action of actions) {
    const list = actionsByBill.get(action.bill_id) || [];
    list.push(action);
    actionsByBill.set(action.bill_id, list);
  }

  const changes = [];
  for (const bill of bills) {
    const stored = (actionsByBill.get(bill.id) || [])
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((action) => action.detail || "");
    const next = deriveBillStatus(stored, bill.latest_action || undefined);
    if (next !== bill.status) changes.push({ id: bill.id, from: bill.status, to: next });
  }

  const transitions = new Map();
  for (const change of changes) {
    const key = `${change.from} -> ${change.to}`;
    transitions.set(key, (transitions.get(key) || 0) + 1);
  }

  console.log(`\nbills needing a status change: ${changes.length} of ${bills.length}`);
  for (const [key, count] of [...transitions.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(6)}  ${key}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN -- pass --apply to write.");
    return;
  }

  let done = 0;
  let failed = 0;
  for (const change of changes) {
    const response = await fetch(`${URL_BASE}/rest/v1/bills?id=eq.${encodeURIComponent(change.id)}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ status: change.to }),
    });
    if (response.ok) done += 1;
    else {
      failed += 1;
      console.log(`FAILED ${change.id}: ${response.status} ${await response.text()}`);
    }
  }
  console.log(`\npatched: ${done}, failed: ${failed}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
