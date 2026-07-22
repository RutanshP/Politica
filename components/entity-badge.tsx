import { Badge } from "@/components/ui/badge";

/** Kept for the many call sites that predate the shared Badge tone vocabulary. */
export function EntityBadge({
  children,
  tone = "brand",
}: {
  children: React.ReactNode;
  tone?: "brand" | "subtle";
}) {
  return <Badge tone={tone === "brand" ? "indigo" : "slate"}>{children}</Badge>;
}
