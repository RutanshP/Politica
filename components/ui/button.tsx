import Link from "next/link";

import { cn } from "@/lib/utils";

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-[var(--r-sm)] text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:h-3.5 [&>svg]:w-3.5";

const VARIANTS = {
  primary: "bg-[var(--accent)] font-semibold text-white hover:bg-[#5457e5]",
  ghost:
    "border border-[var(--line)] text-[var(--ink)] hover:border-[var(--line-2)] hover:bg-[var(--panel-2)] [&>svg]:text-[var(--muted)]",
  subtle: "text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--ink)]",
} as const;

const SIZES = {
  sm: "h-7.5 px-2.5",
  md: "h-9 px-3.5",
} as const;

type Variant = keyof typeof VARIANTS;
type Size = keyof typeof SIZES;

export function buttonClass(
  variant: Variant = "ghost",
  size: Size = "md",
  className?: string | false | null,
) {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

export function Button({
  variant = "ghost",
  size = "md",
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button className={buttonClass(variant, size, className)} {...props}>
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "ghost",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

/** Square icon-only control (overflow menus, bookmark toggles, header actions). */
export function IconButton({
  label,
  bordered,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  bordered?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "grid h-9 w-9 flex-none place-items-center rounded-[var(--r-sm)] text-[var(--muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--ink)] [&>svg]:h-4.5 [&>svg]:w-4.5",
        bordered && "border border-[var(--line)]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
