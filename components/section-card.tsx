export function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[32px] border border-white/60 bg-[var(--panel)] p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
      <div className="mb-5">
        <h2 className="font-display text-lg font-semibold text-[var(--ink)]">
          {title}
        </h2>
        {description ? (
          <p className="mt-2 text-sm text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
