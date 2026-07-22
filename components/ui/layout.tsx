import { cn } from "@/lib/utils";

/**
 * Main column plus a sticky right rail. Collapses to a single column below xl, where the rail
 * content stacks underneath rather than being cut off.
 */
export function WithRail({
  children,
  rail,
  className,
}: {
  children: React.ReactNode;
  rail: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        /*
         * The single-column base needs an explicit minmax(0,1fr): without it the implicit track
         * is `auto`, which sizes to the widest child's max-content and pushes the whole page into
         * a horizontal scroll on narrow viewports (min-w-0 on the child can't cap an auto track).
         */
        "grid items-start gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_300px]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-3.5">{children}</div>
      <aside className="flex flex-col gap-3.5 xl:sticky xl:top-20">{rail}</aside>
    </div>
  );
}

/** Vertical stack of cards at the standard gap. */
export function Stack({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("flex min-w-0 flex-col gap-3.5", className)}>{children}</div>;
}

/** Toolbar strip inside a Card, above a table or list. */
export function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-3 border-b border-[var(--line)] px-3.5 py-2.5">
      {children}
    </div>
  );
}
