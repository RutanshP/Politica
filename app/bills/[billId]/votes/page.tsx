import { redirect } from "next/navigation";

/**
 * Folded into Version Details, which now renders the chart, the tally and the full member table
 * under the selected version.
 *
 * Keeping both meant two vote views with two different pickers: this page carried its own list of
 * the bill's other roll calls, so choosing a version and then asking to see its votes led to a page
 * that could disagree with the version you had just picked.
 *
 * A redirect rather than a deletion -- the path is linked from the home page, from search and from
 * anything bookmarked, and ?voteId= was a real deep link. It maps onto ?vote=, which the version
 * page resolves to that roll call's own entry.
 *
 * One behaviour is deliberately not carried over: this page defaulted to the first *substantive*
 * vote, skipping procedural motions. Version Details defaults to the most recent version instead,
 * which is the rule the selector states and is what a reader arriving without a specific vote in
 * mind expects.
 */
export default async function BillVotesRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ billId: string }>;
  searchParams: Promise<{ voteId?: string }>;
}) {
  const { billId } = await params;
  const { voteId } = await searchParams;

  const query = new URLSearchParams({ view: "votes" });
  if (voteId) query.set("vote", voteId);

  redirect(`/bills/${billId}/version?${query.toString()}`);
}
