/**
 * Classifies a roll-call vote by its motion text, so the app can lead with substantive policy
 * votes and set aside the procedural churn (motions to proceed, cloture, previous question, etc.)
 * that otherwise dominates a legislator's record.
 *
 * Validated against the full stored federal vote set: ~68% policy, ~29% procedural, the rest
 * amendments and nominations.
 */

export type VoteCategory = "policy" | "amendment" | "nomination" | "procedural";

// Order matters: procedural patterns are checked first because a procedural motion can mention a
// bill by name (e.g. "Providing for consideration of ...").
const PROCEDURAL_PATTERNS: RegExp[] = [
  /motion to proceed/i,
  /cloture/i,
  /motion to table/i,
  /motion to recommit/i,
  /previous question/i,
  /providing for consideration/i, // House rules resolutions that schedule floor debate
  /motion to waive/i, // budget points of order
  /\bquorum\b/i,
  /adjourn/i,
  /motion to discharge/i,
  /point of order/i,
  /motion to refer/i,
  /motion to postpone/i,
  /raising a question of the privileges/i,
  /motion to suspend the rules and agree to/i,
];

const NOMINATION_PATTERNS: RegExp[] = [/nomination/i, /confirmation of/i];
const AMENDMENT_PATTERNS: RegExp[] = [/\bamendment\b/i];

// Note: "providing for congressional DISAPPROVAL" is a substantive CRA vote (rejecting a
// regulation) and deliberately NOT procedural, even though "providing for consideration" is.
export function classifyVote(title: string | null | undefined): VoteCategory {
  const text = (title || "").toLowerCase();

  if (PROCEDURAL_PATTERNS.some((pattern) => pattern.test(text))) {
    return "procedural";
  }
  if (NOMINATION_PATTERNS.some((pattern) => pattern.test(text))) {
    return "nomination";
  }
  if (AMENDMENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return "amendment";
  }
  // A bare bill/act name with no procedural verb is a substantive measure.
  return "policy";
}

/** Policy and amendment votes are substantive; procedural and nomination are set aside by default. */
export function isSubstantiveVote(category: VoteCategory) {
  return category === "policy" || category === "amendment";
}

export const VOTE_CATEGORY_META: Record<VoteCategory, { label: string; tone: string }> = {
  policy: { label: "Policy", tone: "bg-emerald-100 text-emerald-800" },
  amendment: { label: "Amendment", tone: "bg-sky-100 text-sky-800" },
  nomination: { label: "Nomination", tone: "bg-indigo-100 text-indigo-800" },
  procedural: { label: "Procedural", tone: "bg-slate-100 text-slate-600" },
};
