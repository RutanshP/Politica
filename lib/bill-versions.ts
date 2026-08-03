import type { Bill, Vote } from "@/types/civic";

/**
 * A "version" is whatever the House had in front of it: the bill's own text at a milestone, or a
 * proposed amendment to that text. They belong in one list because from a reader's side they answer
 * the same question -- what was being voted on -- and separating them buries the amendments, which
 * are where nearly all the roll calls are. H.R. 8800 has 2 bill texts and 19 amendments.
 */
/**
 * `vote` covers a roll call that is not on an amendment -- passage, a motion to recommit, a motion
 * to table. These used to be folded into the bill text they were taken on, which meant only the
 * first one got anywhere: a bill with both a recommit and a passage vote left the second with no
 * entry at all, so a link to it resolved to nothing and fell back to the newest version. That is
 * what made clicking a member's fifth vote open the wrong thing.
 */
export type BillVersionKind = "text" | "amendment" | "vote";

export interface BillVersionEntry {
  /** URL-safe, stable across syncs: `text-<versionId>` or `amdt-<voteId>`. */
  id: string;
  kind: BillVersionKind;
  /** "Introduced in House" or "H.Amdt. 266". */
  label: string;
  /** "Grothman (R-WI)" for an amendment; the reporting committee or sponsor for a bill text. */
  sponsor?: string;
  /** What the amendment does, where the source says. */
  summary?: string;
  date: string;
  /** Parsed `date`, for ordering. 0 when unparseable, which sorts last rather than throwing. */
  time: number;
  /** The roll call this version was decided by, where there was one. */
  voteId?: string;
  result?: string;
  tally?: { yea: number; nay: number; present: number; notVoting: number };
  /** congress.gov page for the amendment, or the official document for a bill text. */
  sourceUrl?: string;
  /** The amendment's own legislative text, where the Rules Committee PDF yielded one. */
  amendmentText?: string;
}

/**
 * Splits an amendment's text into its instruction line and the language it proposes.
 *
 * Amendments open with a structural address -- "At the end of subtitle A of title XI, insert the
 * following new section:" -- and that line is the most useful sentence in the document: it says
 * where the change lands. Pulling it out lets the reader see the target before the body.
 *
 * Returns the whole text as `body` when no instruction is recognisable, which is the honest
 * outcome for the phrasings this does not cover -- better a plain document than a wrong anchor.
 */
export function splitAmendmentText(text?: string) {
  if (!text) return undefined;

  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  // The first two lines are the Rules Comm. Print header and the sponsor; the instruction follows.
  const instructionIndex = lines.findIndex((line) =>
    /^(at the end of|page \d+|in section|strike|insert|add the following|beginning on page)/i.test(line));

  if (instructionIndex === -1) {
    return { instruction: undefined, body: lines.join("\n") };
  }

  return {
    instruction: lines[instructionIndex],
    body: lines.slice(instructionIndex + 1).join("\n"),
  };
}

function parseTime(value?: string) {
  const parsed = Date.parse(value || "");
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Newest first, preserving source order within a shared date.
 *
 * Dates here have day resolution and a bill can draw fifteen roll calls in one sitting, so the
 * tiebreak decides real ordering rather than edge cases. Both inputs already arrive newest-first --
 * votes from the `voted_on desc` query, bill texts from the normalizer -- so a stable sort keeps
 * H.Amdt. 266 (roll 276) above H.Amdt. 261 (roll 275). Reversing the index instead, which is what
 * this did first, silently inverted every same-day group.
 */
function byRecentFirst<T extends { time: number }>(entries: T[]) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => right.entry.time - left.entry.time || left.index - right.index)
    .map((wrapped) => wrapped.entry);
}

/** Roll calls on an amendment, which are the ones that become their own version entry. */
function isAmendmentVote(vote: Vote) {
  return Boolean(vote.amendmentNumber) || /agreeing to the amendment/i.test(vote.question || vote.title || "");
}

export function buildBillVersionEntries(bill: Bill, votes: Vote[]): BillVersionEntry[] {
  const amendments: BillVersionEntry[] = votes.filter(isAmendmentVote).map((vote) => ({
    id: `amdt-${vote.id}`,
    kind: "amendment" as const,
    // Falls back to the motion for rows synced before votes.amendment_number existed.
    label: vote.amendmentNumber || vote.question || vote.title,
    sponsor: vote.amendmentSponsor,
    summary: vote.description,
    date: vote.dateLabel,
    time: parseTime(vote.dateLabel),
    voteId: vote.id,
    result: vote.result,
    tally: { yea: vote.yea, nay: vote.nay, present: vote.present, notVoting: vote.notVoting },
    sourceUrl: vote.amendmentUrl,
    amendmentText: vote.amendmentText,
  }));

  const texts: BillVersionEntry[] = bill.versions.map((version) => ({
    id: `text-${version.id}`,
    kind: "text" as const,
    label: version.label,
    date: version.date,
    time: parseTime(version.date),
    sourceUrl: version.sourceUrl,
  }));

  /*
   * Every remaining roll call gets its own entry, rather than being folded into the bill text it
   * was taken on. Folding looked tidier and was wrong: H.R. 8800 has both a motion to recommit
   * (roll 277) and passage (roll 278) on the same text, so only the first could claim it and the
   * second became unreachable. Every vote must resolve, or a link to it silently opens something
   * else.
   */
  const otherVotes: BillVersionEntry[] = votes.filter((vote) => !isAmendmentVote(vote)).map((vote) => ({
    id: `vote-${vote.id}`,
    kind: "vote" as const,
    label: vote.question || vote.title,
    date: vote.dateLabel,
    time: parseTime(vote.dateLabel),
    voteId: vote.id,
    result: vote.result,
    tally: { yea: vote.yea, nay: vote.nay, present: vote.present, notVoting: vote.notVoting },
  }));

  return byRecentFirst([...amendments, ...otherVotes, ...texts]);
}

/**
 * Which entry the page should show.
 *
 * `requestedId` wins, then the entry carrying `voteId` -- that is what makes a link from a member's
 * vote land on the exact amendment they voted on. Otherwise the most recent, so an unqualified
 * visit opens on the latest state of the bill.
 *
 * Falls back rather than 404s on an id that no longer exists: version ids move when a bill
 * re-syncs, and a stale bookmark should still land on readable text.
 */
export function resolveBillVersion(
  entries: BillVersionEntry[],
  options?: { versionId?: string; voteId?: string },
): BillVersionEntry | undefined {
  if (options?.versionId) {
    const requested = entries.find((entry) => entry.id === options.versionId);
    if (requested) return requested;
  }

  if (options?.voteId) {
    const byVote = entries.find((entry) => entry.voteId === options.voteId);
    if (byVote) return byVote;
  }

  return entries[0];
}

/**
 * The bill text a version sits against: itself for a text, the operative one otherwise.
 *
 * An amendment and a passage vote both read against the text in force on their date, so the Text
 * view shows the same document either way -- what changes is the amendment panel above it.
 */
export function baseTextForVersion(entries: BillVersionEntry[], selected?: BillVersionEntry) {
  if (!selected) return undefined;
  if (selected.kind === "text") return selected;

  const texts = entries.filter((entry) => entry.kind === "text");
  return texts.find((entry) => entry.time > 0 && entry.time <= selected.time) ?? texts[0];
}
