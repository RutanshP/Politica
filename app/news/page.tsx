import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { getNewsData } from "@/lib/data/news";

export default async function NewsPage() {
  const { news, availability } = await getNewsData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="News"
        title="Connected political coverage"
        description="A stored feed tied back to synced bills, committees, politicians, and issues."
        actions={<SourceBadge label={availability === "live" ? "Stored news feed" : "News feed awaiting sync"} live={availability === "live"} />}
      />
      <SectionCard title="Top stories">
        {news.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {news.map((item) => (
              <article
                key={item.id}
                className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-5"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  {item.source} | {item.publishedAt}
                </p>
                <h2 className="mt-3 font-display text-xl font-semibold text-[var(--ink)]">
                  {item.headline}
                </h2>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  {item.summary}
                </p>
                {item.url ? (
                  <a href={item.url} className="mt-4 inline-flex text-sm font-semibold text-[var(--accent-2)]">
                    Open source article
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            No stored news feed is available yet. Run the legislative sync after your database tables are created.
          </p>
        )}
      </SectionCard>
    </div>
  );
}
