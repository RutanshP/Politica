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
    <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]">
        {label}
      </p>
      <p className="num mt-2 text-2xl font-semibold tracking-[-0.02em] text-[var(--ink)]">
        {value}
      </p>
      {detail ? (
        <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--faint)]">{detail}</p>
      ) : null}
    </div>
  );
}
