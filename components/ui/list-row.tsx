import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The repeating "icon / title+subtitle / trailing" row that makes up most feed and summary
 * cards. Rows carry their own hairline divider, so a list of them inside `<CardBody tight>`
 * needs no separator markup of its own.
 */
export function ListRow({
  href,
  leading,
  title,
  subtitle,
  trailing,
  className,
}: {
  href?: string;
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        {/*
          Federal bill titles routinely run 300+ characters ("A bill to require the Federal
          Communications Commission to..."), which turned every feed row into a paragraph.

          No `block` here: line-clamp sets `display: -webkit-box`, and a display utility alongside
          it wins the cascade and silently disables the clamp.
        */}
        <span className="line-clamp-2 text-[13px] font-medium leading-snug text-[var(--ink)]">
          {title}
        </span>
        {subtitle ? (
          <span className="mt-0.5 line-clamp-1 text-xs text-[var(--muted)]">{subtitle}</span>
        ) : null}
      </span>
      {trailing ? <span className="flex-none">{trailing}</span> : null}
    </>
  );

  const classes = cn(
    "flex min-w-0 items-center gap-2.5 rounded-[var(--r-sm)] px-2 py-2.5 transition",
    "[&+&]:rounded-none [&+&]:border-t [&+&]:border-[var(--line)]",
    href && "hover:bg-white/3",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    );
  }

  return <div className={classes}>{body}</div>;
}

/** Numeric rank chip for ordered lists (trending bills). */
export function Rank({ children }: { children: React.ReactNode }) {
  return (
    <span className="num grid h-5.5 w-5.5 flex-none place-items-center rounded-md bg-white/5 text-[11.5px] font-semibold text-[var(--muted)]">
      {children}
    </span>
  );
}
