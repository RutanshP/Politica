import { redirect } from "next/navigation";

/**
 * There are no accounts, so there is no profile. This page was a "workspace summary" for a
 * placeholder user; it now forwards so old links still land somewhere useful.
 */
export default function ProfileRedirect() {
  redirect("/watchlist");
}
