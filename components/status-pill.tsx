import { cn } from "@/lib/utils";
import type { BillStatus } from "@/types/civic";

const toneMap: Record<BillStatus, string> = {
  Introduced: "bg-slate-100 text-slate-700",
  "In Committee": "bg-amber-100 text-amber-800",
  "On Floor": "bg-sky-100 text-sky-800",
  "Passed Chamber": "bg-emerald-100 text-emerald-800",
  "Sent to President": "bg-indigo-100 text-indigo-800",
  Signed: "bg-emerald-100 text-emerald-800",
  Failed: "bg-rose-100 text-rose-800",
};

export function StatusPill({ status }: { status: BillStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
        toneMap[status],
      )}
    >
      {status}
    </span>
  );
}
