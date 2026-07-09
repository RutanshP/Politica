import { cn } from "@/lib/utils";
import type { BillAction } from "@/types/civic";

export function Timeline({ items }: { items: BillAction[] }) {
  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div key={`${item.date}-${item.label}`} className="flex gap-4">
          <div className="flex flex-col items-center">
            <span
              className={cn(
                "h-3 w-3 rounded-full",
                item.type === "milestone" && "bg-emerald-500",
                item.type === "committee" && "bg-blue-500",
                item.type === "floor" && "bg-amber-500",
                item.type === "executive" && "bg-violet-500",
              )}
            />
            {index < items.length - 1 ? (
              <span className="mt-2 h-full w-px bg-slate-200" />
            ) : null}
          </div>
          <div className="pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
              {item.date}
            </p>
            <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
              {item.label}
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">{item.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
