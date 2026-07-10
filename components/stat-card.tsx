export function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
}) {
  return (
    <div className="rounded-[28px] border border-white/60 bg-[var(--panel)] p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-3 font-display text-4xl font-semibold text-[var(--ink)]">
        {value}
      </p>
      {detail ? <p className="mt-2 text-sm text-[var(--muted)]">{detail}</p> : null}
    </div>
  );
}
