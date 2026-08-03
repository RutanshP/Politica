import type { Vote } from "@/types/civic";

export type MemberPosition = "Yea" | "Nay" | "Present" | "Not Voting" | "Unknown";

export interface GroupedBillVotes {
  key: string;
  billId?: string;
  /** Display-normalized: the stored values are inconsistent ("H R 8800" beside "HR.8884"). */
  billNumber: string;
  /** Only set when a roll call carried the measure's title rather than a motion. */
  billTitle?: string;
  /** Roll calls on this measure, most recent first. */
  votes: Vote[];
  counts: Record<MemberPosition, number>;
  latestTime: number;
}

/**
 * House and Senate feeds spell the same measure differently -- "H R 8800" from the Clerk, "HR.8884"
 * from the detail endpoint -- and both appeared verbatim in the vote list, so one member's page
 * showed two spellings a row apart. Normalizes to a single "HR 8800" shape for display only; the
 * stored value still drives the link.
 */
export function formatBillNumber(raw: string) {
  const match = /^\s*([A-Za-z][A-Za-z.\s]*?)[\s.]*(\d+)\s*$/.exec(raw || "");
  if (!match) return (raw || "").trim();

  const letters = match[1].replace(/[^A-Za-z]/g, "").toUpperCase();
  return letters ? `${letters} ${match[2]}` : match[2];
}

/**
 * Whether `title` is the measure's name rather than a restatement of the motion.
 *
 * Where `question` is populated the test is exact -- the sync only replaces title with the bill's
 * name, so a title differing from the question is that name. Rows synced before votes.question
 * existed have no question to compare against, so they fall back to the motion convention: both
 * chambers phrase one as "On ...".
 */
function measureTitleOf(vote: Vote) {
  const title = (vote.title || "").trim();
  if (!title) return undefined;
  if (vote.question) return title === vote.question.trim() ? undefined : title;
  return /^on\b/i.test(title) ? undefined : title;
}

/** What a roll call's row should be labelled: the motion, however the record spells it. */
export function voteQuestionOf(vote: Vote) {
  return vote.question?.trim() || vote.title;
}

function positionOf(vote: Vote): MemberPosition {
  const value = vote.positions[0]?.vote;
  return value === "Yea" || value === "Nay" || value === "Present" || value === "Not Voting"
    ? value
    : "Unknown";
}

function voteTime(vote: Vote) {
  const parsed = Date.parse(vote.dateLabel);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Roll-call number, for ordering votes that share a date.
 *
 * dateLabel has day resolution and a bill can draw fifteen roll calls in one sitting, so sorting on
 * the date alone left them in whatever order the query returned -- there was no answer to "which of
 * these is the newer one". Roll numbers are assigned in order within a session, so they are the
 * sequence. Taken from canonicalId ("house-roll-119-2-255") and falling back to the padded id.
 */
function rollSequence(vote: Vote) {
  const source = vote.canonicalId || vote.id || "";
  const trailing = /(\d+)\s*$/.exec(source);
  return trailing ? Number(trailing[1]) : 0;
}

/** Newest first: by day, then by roll-call number within the day. */
function compareRecentFirst(left: Vote, right: Vote) {
  return voteTime(right) - voteTime(left) || rollSequence(right) - rollSequence(left);
}

/**
 * Collapses a member's roll calls into one entry per measure.
 *
 * A single bill routinely draws five or six recorded votes -- several amendments, a motion to
 * recommit, then passage -- and rendering each as its own card filled the list with repetitions of
 * the same bill number while pushing every other measure off the page. H.R. 8800 alone accounted
 * for six of the eight visible rows.
 *
 * Grouped on bill id, never on the printed number: the number is spelled inconsistently across
 * feeds, and two states can share one. Roll calls with no linked bill stay separate, since without
 * an id there is nothing to prove they belong together.
 */
export function groupVotesByBill(votes: Vote[]): GroupedBillVotes[] {
  const groups = new Map<string, GroupedBillVotes>();

  for (const vote of votes) {
    const key = vote.billId ? `bill:${vote.billId}` : `vote:${vote.id}`;
    const group = groups.get(key) ?? {
      key,
      billId: vote.billId,
      billNumber: formatBillNumber(vote.billNumber),
      billTitle: undefined,
      votes: [],
      counts: { Yea: 0, Nay: 0, Present: 0, "Not Voting": 0, Unknown: 0 },
      latestTime: 0,
    };

    group.votes.push(vote);
    group.counts[positionOf(vote)] += 1;
    group.latestTime = Math.max(group.latestTime, voteTime(vote));
    group.billTitle = group.billTitle ?? measureTitleOf(vote);

    groups.set(key, group);
  }

  for (const group of groups.values()) {
    group.votes.sort(compareRecentFirst);
  }

  return [...groups.values()].sort((left, right) =>
    right.latestTime - left.latestTime
    || rollSequence(right.votes[0]) - rollSequence(left.votes[0]));
}

/** "4 Yea · 2 Nay", in a fixed order so the same split always reads the same way. */
export function summarizePositions(counts: Record<MemberPosition, number>) {
  const order: MemberPosition[] = ["Yea", "Nay", "Present", "Not Voting", "Unknown"];
  return order
    .filter((key) => counts[key] > 0)
    .map((key) => `${counts[key]} ${key === "Unknown" ? "unrecorded" : key}`)
    .join(" · ");
}
