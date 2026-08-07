import {
  fetchAmendmentPdfText,
  fetchRulesAmendments,
  matchRulesRow,
} from "@/lib/adapters/amendment-text";
import { fetchCongressBillAmendments, type CongressAmendmentListItem } from "@/lib/adapters/congress";
import { fetchSupabaseRows, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";
import type { VoteRow } from "@/types/supabase";

/**
 * Labels amendment roll calls with the amendment they were on.
 *
 * H.R. 8800 drew 19 amendment votes that all rendered as "On Agreeing to the Amendment", which is
 * unreadable and, worse, unanswerable -- there was no stored fact saying which amendment a member
 * had voted for. Congress.gov returns a bill's amendments in one request, each with its purpose and
 * a latest action naming the roll call, so a single call labels a bill's whole slate.
 */

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Only these motions are on an amendment; passage and recommit are not, and must not be relabelled. */
const AMENDMENT_QUESTION = /agreeing to the amendment/i;

/**
 * "... Failed by recorded vote: 175 - 254 (Roll no. 276)." -> 276
 *
 * The roll number is the join key because it is the one identifier both sides share: the Clerk's
 * roll-call feed keys on it (votes.source_id is "roll-276") and Congress.gov prints it in the
 * amendment's action text. The amendment's own number is useless for this -- "an amendment numbered
 * 316 printed in Part A" is its number under the rule, which matches nothing we store.
 */
export function parseRollCallNumber(actionText?: string | null) {
  const match = /\(roll\s*no\.\s*(\d+)\)/i.exec(actionText || "");
  return match ? match[1] : null;
}

/**
 * Sponsor surname out of "On agreeing to the Grothman amendment (A025) Failed by ...".
 *
 * The amendments *list* endpoint omits the sponsors array -- only the per-amendment detail carries
 * it, and that would be one extra request per amendment against a rate-limited API for a name the
 * action text already states. Returns null rather than guessing when the phrasing differs.
 */
export function parseAmendmentSponsor(actionText?: string | null) {
  const match = /on agreeing to the\s+(.+?)\s+amendment/i.exec(actionText || "");
  const name = match?.[1]?.trim();
  // "the amendment" with no name, or a whole clause, is not a surname.
  return name && name.length <= 40 && !/^amendments?$/i.test(name) ? name : null;
}

/** "H.Amdt. 266", from the type/number pair the list endpoint returns. */
function formatAmendmentNumber(amendment: CongressAmendmentListItem) {
  const number = (amendment.number || "").trim();
  if (!number) return null;

  const type = (amendment.type || "").toUpperCase();
  const prefix = type === "HAMDT" ? "H.Amdt." : type === "SAMDT" ? "S.Amdt." : type || "Amdt.";
  return `${prefix} ${number}`;
}

export interface AmendmentLink {
  rollCallNumber: string;
  amendmentNumber: string | null;
  sponsor: string | null;
  description: string | null;
  url: string | null;
}

/** The roll-call-keyed links a bill's amendment list yields. */
export function buildAmendmentLinks(amendments: CongressAmendmentListItem[]): Map<string, AmendmentLink> {
  const byRollCall = new Map<string, AmendmentLink>();

  for (const amendment of amendments) {
    const rollCallNumber = parseRollCallNumber(amendment.latestAction?.text);
    if (!rollCallNumber) {
      // Amendments withdrawn, ruled out of order, or agreed to by voice vote never got a roll call.
      continue;
    }

    byRollCall.set(rollCallNumber, {
      rollCallNumber,
      amendmentNumber: formatAmendmentNumber(amendment),
      sponsor: amendment.sponsors?.[0]?.fullName?.trim()
        || parseAmendmentSponsor(amendment.latestAction?.text),
      description: (amendment.description || amendment.purpose || "").trim() || null,
      // The api.congress.gov url is the machine endpoint; the public page is where the text reads.
      url: amendment.url?.replace("api.congress.gov/v3", "www.congress.gov").split("?")[0] || null,
    });
  }

  return byRollCall;
}

/*
 * The whole row, because the write is an upsert. PostgREST upsert is INSERT ... ON CONFLICT DO
 * UPDATE with the row as given, so sending only the amendment columns nulls everything else --
 * caught by votes.bill_number's not-null constraint rather than silently. Reading the full row and
 * merging keeps it to one read plus one chunked write, where a PATCH per vote would be one request
 * each. raw_payload is excluded: it is null everywhere since 018 and re-sending it is pure egress.
 */
const LINKABLE_VOTE_SELECT = [
  "id", "bill_id", "canonical_id", "bill_number", "title", "question", "description",
  "amendment_number", "amendment_sponsor", "amendment_url", "amendment_text", "amendment_text_url",
  "chamber", "date_label", "action_time",
  "result", "yea", "nay", "present", "not_voting", "source_system", "source_id",
  "synced_at", "jurisdiction_type", "state_code",
].join(",");
// voted_on is deliberately absent: it is GENERATED ALWAYS from date_label, and Postgres rejects a
// write that carries one ("cannot insert a non-DEFAULT value into column voted_on").

type LinkableVote = VoteRow;

/** Whether this roll call is one an amendment link could apply to. */
function isAmendmentVote(vote: LinkableVote) {
  return AMENDMENT_QUESTION.test(vote.question || vote.title || "");
}

/**
 * Bills that still have unlabelled amendment votes, most roll calls first.
 *
 * Ordering by need is what lets a scheduled job call this with a fixed offset and still work
 * through the backlog -- the same reason listStoredFederalVoteHeadersPage orders nulls-first.
 */
export async function listBillsNeedingAmendmentLinks(limit: number) {
  const rows = await fetchSupabaseRows<LinkableVote>(
    "votes",
    "source_system=in.(house_clerk,senate_lis)&amendment_number=is.null&bill_id=not.is.null&order=bill_id.asc,id.asc",
    { cache: "no-store", paginateAll: true, paginateTiebreaker: null, select: LINKABLE_VOTE_SELECT },
  );

  const byBill = new Map<string, LinkableVote[]>();
  for (const row of rows) {
    if (!row.bill_id || !isAmendmentVote(row)) continue;
    byBill.set(row.bill_id, [...(byBill.get(row.bill_id) ?? []), row]);
  }

  return [...byBill.entries()]
    .sort((left, right) => right[1].length - left[1].length)
    .slice(0, limit)
    .map(([billId, votes]) => ({ billId, votes }));
}

/** "hr-8800" -> the three path segments congress.gov wants. */
export function parseFederalBillId(billId: string, congress: string) {
  const match = /^([a-z]+)-(\d+)$/i.exec(billId.trim());
  return match ? { congress, billType: match[1].toLowerCase(), billNumber: match[2] } : null;
}

export interface AmendmentLinkSyncResult {
  billsScanned: number;
  billsLinked: number;
  votesLabelled: number;
  amendmentTextsFetched: number;
  /** Why text was not stored, per amendment. Senate bills have no Rules page, which is expected. */
  textFailures: {
    noRulesPage: number;
    noMatchingRow: number;
    emptyExtraction: number;
    extractionError: number;
  };
  firstTextError: string | null;
  unmatchedBills: string[];
  at: string;
}

export async function syncAmendmentLinks(options: {
  congress: string;
  limit?: number;
  dryRun?: boolean;
  /** Also pull each amendment's legislative text from its Rules Committee PDF. */
  withText?: boolean;
}): Promise<AmendmentLinkSyncResult> {
  const targets = await listBillsNeedingAmendmentLinks(options.limit ?? 10);
  const updates: VoteRow[] = [];
  const unmatchedBills: string[] = [];
  let billsLinked = 0;
  let amendmentTextsFetched = 0;
  // Broken down by cause: "no text" has four very different explanations and they need telling
  // apart from the sync log rather than by re-running things by hand.
  const textFailures = { noRulesPage: 0, noMatchingRow: 0, emptyExtraction: 0, extractionError: 0 };
  let firstTextError: string | null = null;

  for (const target of targets) {
    const parsed = parseFederalBillId(target.billId, options.congress);
    if (!parsed) {
      unmatchedBills.push(target.billId);
      continue;
    }

    const payload = await fetchCongressBillAmendments(parsed).catch(() => null);
    if (!payload) {
      unmatchedBills.push(target.billId);
      continue;
    }

    const links = buildAmendmentLinks(payload.amendments ?? []);
    let labelledForBill = 0;

    /*
     * The Rules page is fetched once per bill, not once per amendment: it is a ~900KB render
     * listing every amendment submitted to the measure -- 1,007 rows for H.R. 8800 -- and each
     * amendment's PDF link is in it. Only the PDFs are per-amendment.
     */
    let rulesRows: Awaited<ReturnType<typeof fetchRulesAmendments>> = [];
    if (options.withText) {
      try {
        rulesRows = await fetchRulesAmendments(parsed);
      } catch (error) {
        // Senate bills have no Rules Committee page at all, so an empty result is normal there and
        // must not read as a fault. A thrown error is different and is worth surfacing.
        if (!firstTextError) firstTextError = describeError(error).slice(0, 200);
      }
    }

    for (const vote of target.votes) {
      // votes.source_id is "roll-276" for the House feed; that number is the join.
      const rollCallNumber = (vote.source_id || "").replace(/^roll-/i, "").trim();
      const link = links.get(rollCallNumber);
      if (!link) continue;

      let amendmentText: string | null = vote.amendment_text ?? null;
      let amendmentTextUrl: string | null = vote.amendment_text_url ?? null;

      if (options.withText && !amendmentText) {
        if (rulesRows.length === 0) {
          textFailures.noRulesPage += 1;
        } else {
          // Matched on sponsor plus summary overlap: the Rules row and congress.gov state the same
          // amendment in the same words, but neither carries the other's identifier.
          const row = matchRulesRow(rulesRows, { sponsor: link.sponsor, summary: link.description });
          if (!row) {
            textFailures.noMatchingRow += 1;
          } else {
            /*
             * Errors are recorded, not swallowed. Both of these calls used to `.catch(() => null)`,
             * so a failure was indistinguishable from an amendment that simply has no text -- which
             * is why 66 linked amendments sat with no text and no way to tell whether the scrape,
             * the match or pdf.js was at fault.
             */
            try {
              amendmentText = await fetchAmendmentPdfText(row.pdfUrl);
              if (amendmentText) {
                amendmentTextUrl = row.pdfUrl;
                amendmentTextsFetched += 1;
              } else {
                textFailures.emptyExtraction += 1;
              }
            } catch (error) {
              textFailures.extractionError += 1;
              if (!firstTextError) firstTextError = describeError(error).slice(0, 200);
            }
          }
        }
      }

      updates.push({
        ...vote,
        amendment_number: link.amendmentNumber,
        amendment_sponsor: link.sponsor,
        amendment_url: link.url,
        // Overwrites the Clerk's <vote-desc> where both exist: congress.gov states what the
        // amendment does, while <vote-desc> only names its sponsor and number.
        description: link.description,
        amendment_text: amendmentText,
        amendment_text_url: amendmentTextUrl,
      });
      labelledForBill += 1;
    }

    if (labelledForBill > 0) billsLinked += 1;
    else unmatchedBills.push(target.billId);
  }

  if (!options.dryRun && updates.length > 0) {
    await upsertSupabaseRowsInChunks("votes", updates, "id", 100);
  }

  return {
    billsScanned: targets.length,
    billsLinked,
    votesLabelled: updates.length,
    amendmentTextsFetched,
    textFailures,
    firstTextError,
    unmatchedBills: unmatchedBills.slice(0, 25),
    at: new Date().toISOString(),
  };
}
