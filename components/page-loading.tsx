export function PageLoading({
  title = "Loading view",
}: {
  title?: string;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-white/60 bg-[var(--panel)] px-6 py-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <div className="h-3 w-28 animate-pulse rounded-full bg-slate-200" />
        <div className="mt-4 h-10 w-72 animate-pulse rounded-2xl bg-slate-200" />
        <div className="mt-3 h-4 w-[28rem] max-w-full animate-pulse rounded-full bg-slate-100" />
        <p className="mt-4 text-sm text-[var(--muted)]">{title}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-10 w-24 animate-pulse rounded-full bg-white"
          />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[32px] border border-white/60 bg-[var(--panel)] p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          <div className="h-6 w-48 animate-pulse rounded-full bg-slate-200" />
          <div className="mt-6 space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="h-16 animate-pulse rounded-3xl bg-white"
              />
            ))}
          </div>
        </div>
        <div className="rounded-[32px] border border-white/60 bg-[var(--panel)] p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          <div className="h-6 w-40 animate-pulse rounded-full bg-slate-200" />
          <div className="mt-6 grid gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-20 animate-pulse rounded-3xl bg-white"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
