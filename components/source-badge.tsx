import { cn } from "@/lib/utils";

export function SourceBadge({
  label,
  live,
}: {
  label: string;
  live: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-3 py-1 text-xs font-semibold",
        live ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800",
      )}
    >
      {label}
    </span>
  );
}
