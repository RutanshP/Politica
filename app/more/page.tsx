import { redirect } from "next/navigation";

/** The old pipeline dump, replaced by the public data status page. */
export default function MoreRedirect() {
  redirect("/status");
}
