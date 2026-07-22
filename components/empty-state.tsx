import { ButtonLink } from "@/components/ui/button";

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
    <div className="rounded-[var(--r-md)] border border-dashed border-[var(--line-2)] px-6 py-10 text-center">
      <h3 className="text-sm font-semibold text-[var(--ink)]">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-[var(--muted)]">
        {description}
      </p>
      {actionLabel && actionHref ? (
        <div className="mt-4 flex justify-center">
          <ButtonLink href={actionHref} variant="primary">
            {actionLabel}
          </ButtonLink>
        </div>
      ) : null}
    </div>
  );
}
