import { redirect } from "next/navigation";

/**
 * Folded into Version Details, which shows text and votes under one version selector.
 *
 * Kept as a redirect rather than deleted: this path is linked from the bills directory, from
 * search results and from anything already bookmarked, and `?version=` was a real deep link into a
 * specific text version. That parameter maps onto the new `?v=` with a `text-` prefix, so an old
 * link still lands on the version it named.
 */
export default async function BillTextRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ billId: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { billId } = await params;
  const { version } = await searchParams;

  const query = new URLSearchParams({ view: "text" });
  if (version) query.set("v", `text-${version}`);

  redirect(`/bills/${billId}/version?${query.toString()}`);
}
