import { cn } from "@/lib/utils";
import { BILL_STATUS_TONE, PILL_TONE, type Tone } from "@/components/ui/tones";
import type { BillStatus } from "@/types/civic";

/** Soft-filled status pill. The workhorse label across tables, cards, and heroes. */
export function Badge({
  children,
  tone = "slate",
  dot,
  icon,
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  /** Leading dot in the current text color -- used for live/status states. */
  dot?: boolean;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold",
        PILL_TONE[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {icon ? <span className="[&>svg]:h-3 [&>svg]:w-3">{icon}</span> : null}
      {children}
    </span>
  );
}

/** Neutral outlined chip -- for metadata that is descriptive rather than a state. */
export function Tag({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--r-sm)] border border-[var(--line)] bg-white/4 px-2.5 py-1 text-xs text-[var(--muted)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: BillStatus }) {
  return <Badge tone={BILL_STATUS_TONE[status] ?? "slate"}>{status}</Badge>;
}

/** Uppercase micro-label used above values and in table-adjacent metadata. */
export function Label({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
