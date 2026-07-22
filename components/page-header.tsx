export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-3xl text-[13.5px] leading-relaxed text-[var(--muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-none flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
