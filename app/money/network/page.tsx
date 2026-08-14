import { redirect } from "next/navigation";

/**
 * Folded into /money/graph.
 *
 * The two pages were near-identical 64-line files reading the same whole-graph query, so which one
 * was "the" network view depended on which link you followed. /money/graph now scopes to one
 * subject with working filters; keeping a second unscoped copy beside it would only reintroduce
 * the hairball this replaced.
 */
export default function FundingNetworkRedirect() {
  redirect("/money/graph");
}
