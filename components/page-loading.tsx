import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-white/6", className)} />;
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] p-4">
      {children}
    </div>
  );
}

/** Skeleton shaped like the real page: header, stat tiles, tab strip, then main + rail. */
export function PageLoading({ title = "Loading view" }: { title?: string }) {
  return (
    <div className="flex flex-col gap-3.5" aria-busy="true" aria-label={title}>
      <div className="mb-1">
        <Bar className="h-3 w-24" />
        <Bar className="mt-2.5 h-7 w-64" />
        <Bar className="mt-2 h-3.5 w-96 max-w-full" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Panel key={index}>
            <div className="flex items-center gap-2.5">
              <Bar className="h-8.5 w-8.5 rounded-[var(--r-sm)]" />
              <Bar className="h-3 w-20" />
            </div>
            <Bar className="mt-3 h-6 w-16" />
          </Panel>
        ))}
      </div>

      <div className="flex gap-4 border-b border-[var(--line)] pb-2.5">
        {Array.from({ length: 4 }).map((_, index) => (
          <Bar key={index} className="h-3.5 w-16" />
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel>
          <Bar className="h-4 w-40" />
          <div className="mt-4 flex flex-col gap-2.5">
            {Array.from({ length: 6 }).map((_, index) => (
              <Bar key={index} className="h-12" />
            ))}
          </div>
        </Panel>
        <div className="flex flex-col gap-3.5">
          {Array.from({ length: 2 }).map((_, index) => (
            <Panel key={index}>
              <Bar className="h-4 w-28" />
              <div className="mt-4 flex flex-col gap-2.5">
                {Array.from({ length: 3 }).map((__, inner) => (
                  <Bar key={inner} className="h-8" />
                ))}
              </div>
            </Panel>
          ))}
        </div>
      </div>
    </div>
  );
}
