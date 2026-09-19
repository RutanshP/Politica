import type { Metadata } from "next";

import { CongressNetwork } from "@/components/congress-network/congress-network";

export const metadata: Metadata = {
  title: "Congress money network · Politica",
  description: "Every PAC, party committee and leadership PAC that gave to a sitting member of Congress this cycle, and who they have in common.",
};

/**
 * The Congress money network: every sitting member and every committee that gave to one of them,
 * laid out together so shared donors pull members close. Clicking anything focuses it.
 *
 * Replaced a one-subject React Flow neighbourhood view. The data behind this -- named PAC gifts
 * per member -- did not exist before pac_contributions; the old graph only knew one rolled-up
 * "PACs & party committees" total per member, so nothing could connect two members.
 */
export default async function CongressMoneyNetworkPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const { focus } = await searchParams;
  return (
    <>
      <h1 className="sr-only">Congress money network</h1>
      <CongressNetwork initialFocus={focus} />
    </>
  );
}
