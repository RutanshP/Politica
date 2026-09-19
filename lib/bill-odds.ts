import type { BillStatus } from "@/types/civic";

/*
 * Rough odds that a bill becomes law, from how far it has already got.
 *
 * These are historical base rates, not a model of the individual bill. Across recent Congresses
 * only 2-3% of introduced measures are enacted; about a third of measures that clear one chamber
 * go on to become law; almost everything presented to the President is signed.
 *
 * This replaced a per-bill formula -- 30 + 4 x sponsors + 3 x committees + 3 x actions, capped at
 * 85 -- that gave the average bill sitting in committee a 45% chance, a signed law 88% and a
 * failed bill 65%. It was computed at sync time and stored, so it is derived at read time here
 * instead: every stored bill is corrected without a backfill, and it can never drift from status.
 */
const ODDS_BY_STATUS: Record<BillStatus, number> = {
  Introduced: 3,
  "In Committee": 3,
  "On Floor": 20,
  "Passed Chamber": 35,
  "Sent to President": 95,
  Signed: 100,
  Failed: 0,
};

export function chanceOfBecomingLaw(status: BillStatus) {
  return ODDS_BY_STATUS[status] ?? 3;
}
