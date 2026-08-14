import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { NetworkGraph } from "@/components/network-graph";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import {
  RELATIONSHIP_LABELS,
  fetchGraphNeighborhood,
  listGraphFocusOptions,
} from "@/lib/supabase/graph-neighborhood";
import { cn } from "@/lib/utils";

export const revalidate = 21600;

const HOP_OPTIONS = [1, 2] as const;
const AMOUNT_OPTIONS = [
  { label: "Any amount", value: 0 },
  { label: "$10k+", value: 10_000 },
  { label: "$100k+", value: 100_000 },
  { label: "$1M+", value: 1_000_000 },
] as const;

function money(value: number) {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value.toLocaleString()}`;
}

/**
 * The funding graph, scoped to one entity.
 *
 * It used to load all 6,495 entities and 8,009 edges and hand them to React Flow, beside a filter
 * panel of six hardcoded strings that controlled nothing. A network of that size is a hairball at
 * any zoom, and there is no useful question it answers. Every view now starts from a subject, and
 * each control below is a URL parameter that reaches the database.
 */
export default async function FundingGraphPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string; hops?: string; min?: string; rel?: string }>;
}) {
  const params = await searchParams;
  const options = await listGraphFocusOptions(60);
  const focusId = params.focus || options[0]?.id;

  const hops = HOP_OPTIONS.includes(Number(params.hops) as 1 | 2) ? Number(params.hops) : 1;
  const minAmount = Number(params.min) > 0 ? Number(params.min) : 0;
  const relationshipTypes = params.rel ? [params.rel] : undefined;

  const neighborhood = focusId
    ? await fetchGraphNeighborhood({ focusId, hops, minAmount, relationshipTypes })
    : null;

  const buildHref = (next: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const merged = { focus: focusId, hops: String(hops), min: String(minAmount), rel: params.rel, ...next };
    for (const [key, value] of Object.entries(merged)) {
      if (value && value !== "0") query.set(key, value);
    }
    return `/money/graph?${query.toString()}`;
  };

  const summary = neighborhood?.summary;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Money graph"
        title={neighborhood?.focus?.label || "Funding network"}
        description="Who funds whom, one entity at a time — contributions, lobbying retainers and outside spending."
        actions={<SourceBadge label="Stored finance graph" live />}
      />

      {/* Answers something before anyone touches a control. */}
      {summary && summary.edgeCount > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Money in", money(summary.inboundAmount), "var(--success)"],
            ["Money out", money(summary.outboundAmount), "var(--accent-2)"],
            ["Connections", String(summary.edgeCount), "var(--ink)"],
            [
              "Largest counterparty",
              summary.topCounterparty ? money(summary.topCounterparty.amount) : "—",
              "var(--warning)",
            ],
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">{label}</p>
              <p className="num mt-1 text-[22px] font-semibold leading-none" style={{ color: tone }}>{value}</p>
              {label === "Largest counterparty" && summary.topCounterparty ? (
                <p className="mt-1 truncate text-[11px] text-[var(--faint)]">{summary.topCounterparty.label}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <SectionCard title="Filters">
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Subject</p>
              <div className="max-h-56 overflow-auto rounded-[var(--r-sm)] border border-[var(--line)]">
                {options.map((option) => (
                  <Link
                    key={option.id}
                    href={buildHref({ focus: option.id })}
                    className={cn(
                      "block truncate border-b border-[var(--line)] px-2.5 py-1.5 text-[12.5px] last:border-b-0 transition",
                      option.id === focusId
                        ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-2)]"
                        : "text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--ink)]",
                    )}
                  >
                    {option.label}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Depth</p>
              <div className="flex gap-1.5">
                {HOP_OPTIONS.map((option) => (
                  <Link
                    key={option}
                    href={buildHref({ hops: String(option) })}
                    className={cn(
                      "flex-1 rounded-[var(--r-sm)] border px-2 py-1.5 text-center text-[12.5px] font-semibold transition",
                      option === hops
                        ? "border-[var(--accent-2)] bg-[var(--accent-soft)] text-[var(--accent-2)]"
                        : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]",
                    )}
                  >
                    {option} hop{option > 1 ? "s" : ""}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Minimum</p>
              <div className="flex flex-wrap gap-1.5">
                {AMOUNT_OPTIONS.map((option) => (
                  <Link
                    key={option.value}
                    href={buildHref({ min: String(option.value) })}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[12px] font-semibold transition",
                      option.value === minAmount
                        ? "border-[var(--accent-2)] bg-[var(--accent-soft)] text-[var(--accent-2)]"
                        : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]",
                    )}
                  >
                    {option.label}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Relationship</p>
              <div className="flex flex-col gap-1">
                <Link
                  href={buildHref({ rel: undefined })}
                  className={cn(
                    "rounded-[var(--r-sm)] px-2.5 py-1.5 text-[12.5px] transition",
                    !params.rel ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-2)]" : "text-[var(--muted)] hover:text-[var(--ink)]",
                  )}
                >
                  All relationships
                </Link>
                {Object.entries(RELATIONSHIP_LABELS).map(([value, label]) => (
                  <Link
                    key={value}
                    href={buildHref({ rel: value })}
                    className={cn(
                      "rounded-[var(--r-sm)] px-2.5 py-1.5 text-[12.5px] transition",
                      params.rel === value
                        ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-2)]"
                        : "text-[var(--muted)] hover:text-[var(--ink)]",
                    )}
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Network"
          description={
            summary?.truncated
              ? "Showing the largest connections only — narrow the filters to see the rest."
              : undefined
          }
        >
          {neighborhood && neighborhood.edges.length > 0 ? (
            <NetworkGraph
              nodes={neighborhood.nodes}
              edges={neighborhood.edges}
              focusNodeId={focusId}
            />
          ) : (
            <EmptyState
              title="No connections match these filters"
              description="This entity has no stored funding relationships at this depth and minimum. Try a lower minimum, or a different subject."
            />
          )}
        </SectionCard>
      </section>
    </div>
  );
}
