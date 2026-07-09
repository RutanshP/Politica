import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { getNewsData } from "@/lib/data/news";

export default async function NewsPage() {
  const { news } = await getNewsData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="News"
        title="Connected political coverage"
        description="A live-derived feed tied back to bills, committees, politicians, and issues."
      />
      <SectionCard title="Top stories">
        {news.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {news.map((item) => (
              <article
                key={item.id}
                className="rounded-[28px] border border-[var(--line)] bg-white p-5"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  {item.source} · {item.publishedAt}
                </p>
                <h2 className="mt-3 font-display text-xl font-semibold text-[var(--ink)]">
                  {item.headline}
                </h2>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  {item.summary}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            No live news feed is available yet. Add a Congress.gov key to derive coverage from the bill stream.
          </p>
        )}
      </SectionCard>
    </div>
  );
}
