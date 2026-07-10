import Link from "next/link";

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="rounded-[28px] border border-dashed border-[var(--line)] bg-white/80 px-6 py-12 text-center">
      <h3 className="font-display text-xl font-semibold text-[var(--ink)]">{title}</h3>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
        {description}
      </p>
      {actionLabel && actionHref ? (
        <div className="mt-5">
          <Link
            href={actionHref}
            className="inline-flex rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
          >
            {actionLabel}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
