import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

export function Card({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "flex min-w-0 flex-col rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)]",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  icon,
  count,
  actionLabel,
  actionHref,
  children,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  count?: React.ReactNode;
  actionLabel?: string;
  actionHref?: string;
  /** Right-aligned custom controls, used instead of actionLabel/actionHref. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-none items-center gap-2.5 border-b border-[var(--line)] px-4 py-3.5">
      <h3 className="flex items-center gap-2.5 text-sm font-semibold text-[var(--ink)]">
        {icon ? <span className="text-[var(--muted)] [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
        {title}
      </h3>
      {count != null ? (
        <span className="num rounded-full bg-white/6 px-1.5 py-0.5 text-[11px] font-semibold text-[var(--muted)]">
          {count}
        </span>
      ) : null}
      {children ? <div className="ml-auto flex items-center gap-2">{children}</div> : null}
      {!children && actionLabel && actionHref ? (
        <Link
          href={actionHref}
          className="ml-auto text-xs font-medium text-[var(--accent-2)] transition hover:text-[#a5adff]"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function CardBody({
  children,
  className,
  /** No padding -- for tables and other edge-to-edge content. */
  flush,
  /** Reduced padding -- for lists of rows that carry their own inset. */
  tight,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  flush?: boolean;
  tight?: boolean;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "flex min-w-0 flex-1 flex-col",
        flush ? "p-0" : tight ? "px-2 py-1.5" : "px-4 py-3.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardFooter({
  label,
  href,
  children,
}: {
  label?: string;
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex-none border-t border-[var(--line)] px-4 py-2.5">
      {label && href ? (
        <Link
          href={href}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-2)] transition hover:text-[#a5adff]"
        >
          {label}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : (
        children
      )}
    </div>
  );
}

/** Small print under a card body, for provenance notes and "not wired up yet" shells. */
export function CardNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 px-4 pb-3 text-[11px] leading-relaxed text-[var(--faint)]">
      {children}
    </p>
  );
}
