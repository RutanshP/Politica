import { cn } from "@/lib/utils";

export function EntityBadge({
  children,
  tone = "brand",
}: {
  children: React.ReactNode;
  tone?: "brand" | "subtle";
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
        tone === "brand"
          ? "bg-blue-50 text-blue-700"
          : "bg-slate-100 text-slate-600",
      )}
    >
      {children}
    </span>
  );
}
