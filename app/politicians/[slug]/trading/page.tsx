import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PoliticianTabs } from "@/components/politician-tabs";
import { SourceBadge } from "@/components/source-badge";
import { TradeTable } from "@/components/trading/trade-table";
import { TradingYearTable } from "@/components/trading/trading-year-table";
import {
  getPoliticianData,
  getPoliticianSourceLabel,
  isLivePoliticianSource,
} from "@/lib/data/politicians";
import { fetchPoliticianTrading } from "@/lib/supabase/stocks";

export const revalidate = 21600;

function money(value: number) {
  if (!value) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value.toLocaleString()}`;
}

/**
 * A member's disclosed stock trading.
 *
 * Covers both chambers as one history. A member who served in the House before the Senate has
 * filings in two systems that share no identifier, and the sync resolves both onto the same bioguide
 * ID -- so this page shows a continuous career rather than starting at whichever office they hold
 * now. 43 sitting members are in that position.
 */
export default async function PoliticianTradingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { politician, source } = await getPoliticianData(slug);
  if (!politician) notFound();

  const trading = await fetchPoliticianTrading(politician.id);

  const totalTrades = trading.trades.length;
  const scored = trading.years.reduce((total, year) => total + year.scoredTradeCount, 0);
  const disclosedMin = trading.years.reduce((total, year) => total + year.disclosedMin, 0);
  const disclosedMax = trading.years.reduce((total, year) => total + year.disclosedMax, 0);
  const tickers = new Set(trading.trades.map((trade) => trade.ticker).filter(Boolean)).size;

  // Weighted by how many trades each year actually scored, so a year with two scored trades does
  // not carry the same weight as one with sixty.
  const careerAlpha = scored
    ? trading.years.reduce((total, year) => total + (year.avgAlpha ?? 0) * year.scoredTradeCount, 0) / scored
    : null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Stock trading"
        title={politician.name}
        description={`${politician.title} · ${politician.party} · ${politician.district || politician.state}. Transactions disclosed under the STOCK Act, across every chamber they have served in.`}
        actions={
          <SourceBadge
            label={getPoliticianSourceLabel(source)}
            live={isLivePoliticianSource(source)}
          />
        }
      />
      <PoliticianTabs slug={politician.slug} active="trading" />

      {totalTrades === 0 ? (
        <EmptyState
          title="No disclosed trades on record"
          description={
            trading.coverage.total > 0
              ? `${trading.coverage.total} filing${trading.coverage.total === 1 ? "" : "s"} were found for this member, but none could be read — they are scans of paper rather than electronic filings. This is not evidence that no trades occurred.`
              : "No periodic transaction reports have been filed by this member. Members only file when a transaction exceeds $1,000, so this may mean no reportable trades rather than no holdings."
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Disclosed trades", value: String(totalTrades), tone: "var(--ink)", sub: `${tickers} distinct ticker${tickers === 1 ? "" : "s"}` },
              { label: "Disclosed value", value: `${money(disclosedMin)}–${money(disclosedMax)}`, tone: "var(--accent-2)", sub: "range of the filed bands" },
              {
                label: "Avg vs market",
                value: careerAlpha === null ? "—" : `${careerAlpha > 0 ? "+" : ""}${careerAlpha.toFixed(1)}pp`,
                tone: careerAlpha === null ? "var(--faint)" : careerAlpha >= 0 ? "var(--success)" : "var(--danger)",
                sub: scored ? `${scored} of ${totalTrades} trades scored` : "not scored yet",
              },
              { label: "Years active", value: String(trading.years.length), tone: "var(--warning)", sub: trading.years.length ? `${trading.years[trading.years.length - 1].year}–${trading.years[0].year}` : "" },
            ].map((tile) => (
              <div key={tile.label} className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">{tile.label}</p>
                <p className="num mt-1 text-[20px] font-semibold leading-tight" style={{ color: tile.tone }}>
                  {tile.value}
                </p>
                {tile.sub ? <p className="mt-1 text-[11px] text-[var(--faint)]">{tile.sub}</p> : null}
              </div>
            ))}
          </div>

          {trading.coverage.unreadable > 0 ? (
            <div className="rounded-[var(--r-md)] border border-[var(--warning-soft)] bg-[var(--warning-soft)] px-4 py-3 text-[12.5px] text-[var(--warning)]">
              {/* Stated rather than hidden: a filing that could not be read is not the same as a
                  member who did not trade, and the difference has to reach the reader. */}
              {trading.coverage.unreadable} of {trading.coverage.total} filings could not be read
              {trading.coverage.byStatus.scanned ? ` (${trading.coverage.byStatus.scanned} are scans of paper)` : ""}.
              Trades in those filings are missing from this page.
            </div>
          ) : null}

          <TradingYearTable years={trading.years} />
          <TradeTable trades={trading.trades} />
        </>
      )}
    </div>
  );
}
