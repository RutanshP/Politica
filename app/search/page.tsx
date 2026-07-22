import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SearchBar } from "@/components/search-bar";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { searchPolitica } from "@/lib/data/search";

export const revalidate = 21600;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const { results, availability } = await searchPolitica(q);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Search"
        title="Global search"
        description="Search across bills, politicians, committees, issues, news, and other connected entities."
        actions={<SourceBadge label={availability === "live" ? "Stored search index" : "Search index awaiting rebuild"} live={availability === "live"} />}
      />
      <SectionCard title="Search query">
        <SearchBar defaultValue={q} />
      </SectionCard>
      <SectionCard title={q ? `Results for "${q}"` : "Recent entities"}>
        {results.length > 0 ? (
          <div className="space-y-3">
            {results.map((result) => (
              <Link
                key={`${result.type}-${result.id}`}
                href={result.href}
                className="block rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-5 transition hover:border-[var(--line-2)]"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full bg-white/6 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                    {result.type}
                  </span>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                    {result.meta}
                  </p>
                </div>
                <p className="mt-3 text-lg font-semibold text-[var(--ink)]">{result.label}</p>
                <p className="mt-1 text-sm font-medium text-[var(--accent-2)]">{result.title}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{result.description}</p>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No search results found"
            description="Try a bill number, politician name, committee, or issue area."
          />
        )}
      </SectionCard>
      <Pagination page={1} pageSize={results.length || 1} total={results.length} />
    </div>
  );
}
