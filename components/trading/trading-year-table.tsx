import { Badge, Label } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardNote } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TradingYear } from "@/lib/supabase/stocks";

/**
 * Yearly trading performance.
 *
 * The headline number is average alpha: how far the year's disclosed trades ran ahead of simply
 * holding the index, in percentage points. It is deliberately not called a return. Disclosures give
 * dollar bands rather than amounts and never give share counts, so a portfolio return cannot be
 * computed from them by anyone -- while "did these trades beat the market" needs only a date and a
 * ticker, and is fully determined by what was filed.
 */

function money(value: number) {
  if (!value) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value.toLocaleString()}`;
}

function alphaTone(alpha: number | null) {
  if (alpha === null) return "slate" as const;
  if (alpha > 0.5) return "emerald" as const;
  if (alpha < -0.5) return "rose" as const;
  return "slate" as const;
}

function formatAlpha(alpha: number | null) {
  if (alpha === null) return "—";
  return `${alpha > 0 ? "+" : ""}${alpha.toFixed(1)}pp`;
}

export function TradingYearTable({ years }: { years: TradingYear[] }) {
  if (years.length === 0) return null;

  const anyScored = years.some((year) => year.scoredTradeCount > 0);

  return (
    <Card>
      <CardHeader title="By year" count={years.length} />
      <CardBody flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left">
                <th className="px-4 py-2.5"><Label>Year</Label></th>
                <th className="px-4 py-2.5"><Label>Chamber</Label></th>
                <th className="px-4 py-2.5 text-right"><Label>Trades</Label></th>
                <th className="px-4 py-2.5 text-right"><Label>Buys / Sells</Label></th>
                <th className="px-4 py-2.5 text-right"><Label>Disclosed range</Label></th>
                <th className="px-4 py-2.5 text-right"><Label>vs market</Label></th>
              </tr>
            </thead>
            <tbody>
              {years.map((year) => (
                <tr key={year.year} className="border-b border-[var(--line)] last:border-b-0">
                  <td className="num px-4 py-3 font-semibold text-[var(--ink)]">{year.year}</td>
                  <td className="px-4 py-3">
                    {/* Taken from the trades themselves, so a member who changed office reads
                        correctly year by year rather than under their present chamber. */}
                    <span className="text-xs capitalize text-[var(--muted)]">{year.chamber}</span>
                  </td>
                  <td className="num px-4 py-3 text-right text-[var(--ink)]">{year.tradeCount}</td>
                  <td className="num px-4 py-3 text-right text-[var(--muted)]">
                    {year.purchaseCount} / {year.saleCount}
                  </td>
                  <td className="num px-4 py-3 text-right text-[var(--muted)]">
                    {/* Both bounds, never a midpoint: the narrowest band still spans fifteenfold. */}
                    {money(year.disclosedMin)}–{money(year.disclosedMax)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {year.scoredTradeCount > 0 ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <Badge tone={alphaTone(year.avgAlpha)}>{formatAlpha(year.avgAlpha)}</Badge>
                        <span
                          className={cn(
                            "text-[10.5px]",
                            year.scoredTradeCount < year.tradeCount ? "text-[var(--warning)]" : "text-[var(--faint)]",
                          )}
                        >
                          {/* Never let the average look like it covers every trade: bonds have no
                              market price and recent trades have no completed year. */}
                          {year.scoredTradeCount} of {year.tradeCount} scored
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--faint)]">Not scored</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
      <CardNote>
        {anyScored
          ? "“vs market” is the average of each trade’s 365-day performance against the S&P 500, in percentage points. Sales are scored on timing, so selling ahead of a decline counts as positive. This is not a portfolio return — disclosures report dollar bands, never amounts or share counts, so a true return cannot be derived from them."
          : "Trades are recorded, but none has been scored against the market yet. Scoring needs daily price history, which requires a configured price provider."}
      </CardNote>
    </Card>
  );
}
