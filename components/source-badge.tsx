import { Badge } from "@/components/ui/badge";

export function SourceBadge({ label, live }: { label: string; live: boolean }) {
  return (
    <Badge tone={live ? "emerald" : "amber"} dot>
      {label}
    </Badge>
  );
}
