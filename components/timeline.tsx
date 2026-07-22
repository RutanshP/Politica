import { cn } from "@/lib/utils";
import { TONE_COLOR, type Tone } from "@/components/ui/tones";
import type { BillAction } from "@/types/civic";

const TYPE_TONE: Record<BillAction["type"], Tone> = {
  milestone: "emerald",
  committee: "sky",
  floor: "amber",
  executive: "indigo",
};

export function Timeline({ items }: { items: BillAction[] }) {
  return (
    <div className="flex flex-col">
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <div
            key={`${item.date}-${item.label}-${item.detail}-${index}`}
            className="flex gap-3.5"
          >
            <div className="flex flex-none flex-col items-center">
              <span
                className="mt-1.5 h-2.5 w-2.5 flex-none rounded-full ring-4 ring-[var(--panel)]"
                style={{ background: TONE_COLOR[TYPE_TONE[item.type] ?? "slate"] }}
              />
              {!last ? <span className="w-px flex-1 bg-[var(--line-2)]" /> : null}
            </div>
            <div className={cn("min-w-0", last ? "pb-0" : "pb-5")}>
              <p className="num text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]">
                {item.date}
              </p>
              <p className="mt-1 text-[13px] font-semibold text-[var(--ink)]">{item.label}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--muted)]">
                {item.detail}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
