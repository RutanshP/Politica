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

/**
 * The Senate writes a confirmation as "Confirmation: Maria A. Lanahan, of Missouri, to be U.S.
 * District Judge ..." -- the word "nomination" never appears, and the older `/confirmation of/`
 * pattern matched none of the stored Senate votes (the state follows the name, not the noun). Every
 * one of those fell through to "policy", which is why a senator's policy votes read as a list of
 * judicial confirmations.
 */
const NOMINATION_PATTERNS: RegExp[] = [/nomination/i, /\bconfirmation\b\s*[:—-]/i, /confirmation of/i];
const AMENDMENT_PATTERNS: RegExp[] = [/\bamendment\b/i];

/**
 * A Senate vote on a nomination is numbered "PN 150-4". That is a structural fact about the vote
 * rather than a phrasing, so it catches confirmations however the motion text is worded.
 */
const NOMINATION_NUMBER_PATTERN = /^\s*PN[\s.-]/i;

/**
 * The Senate frequently states the motion only in the result: the title of the September 4 vote on
 * S.2296 is the bare bill name, "National Defense Authorization Act for Fiscal Year 2026", and
 * nothing but `result` ("Motion to Proceed Agreed to") says it was a procedural motion rather than
 * passage of the Act. Classifying on the title alone reported those as policy votes.
 *
 * Deliberately excludes the bare "Motion Agreed to" / "Motion Rejected" results: those name no
 * motion at all, so there is nothing to conclude from them either way.
 */
const PROCEDURAL_RESULT_PATTERNS: RegExp[] = [
  /motion to proceed/i,
  /motion to table/i,
  /motion to discharge/i,
  /motion to recommit/i,
  /motion to reconsider/i,
  /motion to adjourn/i,
  /cloture/i,
  /point of order/i,
  /decision of chair/i,
];

export interface VoteClassificationContext {
  /** The measure number, e.g. "PN 150-4", "S.2296", "HR.5371". */
  billNumber?: string | null;
  /** The recorded outcome, e.g. "Motion to Proceed Agreed to", "Nomination Confirmed". */
  result?: string | null;
}

// Note: "providing for congressional DISAPPROVAL" is a substantive CRA vote (rejecting a
// regulation) and deliberately NOT procedural, even though "providing for consideration" is.
export function classifyVote(
  title: string | null | undefined,
  context: VoteClassificationContext = {},
): VoteCategory {
  const text = (title || "").toLowerCase();
  const result = context.result || "";
  const billNumber = context.billNumber || "";

  // Procedural stays first: a motion to proceed on a nomination, or a rules resolution naming a
  // bill, is procedural before it is anything else.
  if (PROCEDURAL_PATTERNS.some((pattern) => pattern.test(text))) {
    return "procedural";
  }
  if (PROCEDURAL_RESULT_PATTERNS.some((pattern) => pattern.test(result))) {
    return "procedural";
  }
  if (NOMINATION_PATTERNS.some((pattern) => pattern.test(text)) || NOMINATION_NUMBER_PATTERN.test(billNumber)) {
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

// VOTE_CATEGORY_META and VoteTypeBadge lived here to label a roll call Policy / Amendment /
// Nomination / Procedural. Their only consumer was the standalone bill votes page, which folded
// into Version Details -- where the version list already names what each roll call was on. Removed
// rather than left as an unused export; classifyVote and isSubstantiveVote still do the real work.
