import { Badge, Label, Tag } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardNote } from "@/components/ui/card";
import type { TradeRecord } from "@/lib/supabase/stocks";
import type { OwnerCode, TransactionType } from "@/lib/stock-disclosures";

/** Individual disclosed transactions, newest first. */

const TYPE_LABEL: Record<TransactionType, string> = {
  purchase: "Buy",
  sale: "Sell",
  sale_full: "Sell (full)",
  sale_partial: "Sell (part)",
  exchange: "Exchange",
  other: "Other",
};

const OWNER_LABEL: Record<OwnerCode, string> = {
  self: "Member",
  spouse: "Spouse",
  child: "Child",
  joint: "Joint",
};

function typeTone(type: TransactionType) {
  if (type === "purchase") return "emerald" as const;
  if (type === "exchange") return "sky" as const;
  if (type === "other") return "slate" as const;
  return "rose" as const;
}

function band(min: number | null, max: number | null) {
  if (min === null && max === null) return "Not disclosed";
  const format = (value: number) =>
    value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : `$${Math.round(value).toLocaleString()}`;
  if (max === null) return `${format(min as number)}+`;
  if (min === null) return `up to ${format(max)}`;
  return `${format(min)} – ${format(max)}`;
}

function dayLabel(date: string | null) {
  if (!date) return "—";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Days between the trade and its disclosure. Members have 45; the gap is itself informative. */
function reportingLag(transactionDate: string | null, filedOn: string | null) {
  if (!transactionDate || !filedOn) return null;
  const days = Math.round(
    (Date.parse(`${filedOn}T00:00:00Z`) - Date.parse(`${transactionDate}T00:00:00Z`)) / 86_400_000,
  );
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export function TradeTable({ trades }: { trades: TradeRecord[] }) {
  return (
    <Card>
      <CardHeader title="Individual trades" count={trades.length} />
      <CardBody flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left">
                <th className="px-4 py-2.5"><Label>Date</Label></th>
                <th className="px-4 py-2.5"><Label>Asset</Label></th>
                <th className="px-4 py-2.5"><Label>Type</Label></th>
                <th className="px-4 py-2.5"><Label>Owner</Label></th>
                <th className="px-4 py-2.5 text-right"><Label>Amount</Label></th>
                <th className="px-4 py-2.5 text-right"><Label>vs market</Label></th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => {
                const lag = reportingLag(trade.transactionDate, trade.filedOn);
                return (
                  <tr key={trade.id} className="border-b border-[var(--line)] last:border-b-0 align-top">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="num text-[var(--ink)]">{dayLabel(trade.transactionDate)}</div>
                      {lag !== null ? (
                        <div className="mt-0.5 text-[10.5px] text-[var(--faint)]">disclosed {lag}d later</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {trade.ticker ? (
                          <span className="num text-[13px] font-semibold text-[var(--ink)]">{trade.ticker}</span>
                        ) : null}
                        <span className="line-clamp-2 text-[13px] text-[var(--muted)]">{trade.assetName}</span>
                      </div>
                      {trade.comment ? (
                        <div className="mt-1 text-[10.5px] text-[var(--faint)]">{trade.comment}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={typeTone(trade.transactionType)}>{TYPE_LABEL[trade.transactionType]}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {/* Spouse and dependent-child trades are disclosed on the member's filing.
                          Presenting them as the member's own would be a misattribution. */}
                      {trade.owner === "self" ? (
                        <span className="text-xs text-[var(--faint)]">{OWNER_LABEL.self}</span>
                      ) : (
                        <Tag>{OWNER_LABEL[trade.owner]}</Tag>
                      )}
                    </td>
                    <td className="num px-4 py-3 text-right whitespace-nowrap text-[var(--muted)]">
                      {band(trade.amountMin, trade.amountMax)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {trade.alpha === null ? (
                        <span className="text-xs text-[var(--faint)]">—</span>
                      ) : (
                        <div className="flex flex-col items-end gap-0.5">
                          <span
                            className="num text-[13px] font-semibold"
                            style={{ color: trade.alpha >= 0 ? "var(--success)" : "var(--danger)" }}
                          >
                            {trade.alpha > 0 ? "+" : ""}
                            {trade.alpha.toFixed(1)}pp
                          </span>
                          <span className="num text-[10.5px] text-[var(--faint)]">
                            {trade.tradeReturn !== null ? `${trade.tradeReturn > 0 ? "+" : ""}${trade.tradeReturn.toFixed(1)}%` : ""}
                            {trade.benchmarkReturn !== null ? ` vs ${trade.benchmarkReturn > 0 ? "+" : ""}${trade.benchmarkReturn.toFixed(1)}%` : ""}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardBody>
      <CardNote>
        Amounts are the disclosed bands, shown in full rather than as a midpoint. “vs market” compares
        the asset against the S&P 500 over the 365 days after the trade.
      </CardNote>
    </Card>
  );
}
