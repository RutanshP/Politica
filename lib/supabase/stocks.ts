import { STOCKS_CACHE_TAG } from "@/lib/supabase/cache-tags";
import { fetchSupabaseRows } from "@/lib/supabase/rest";
import type { OwnerCode, TransactionType } from "@/lib/stock-disclosures";

/**
 * Stored trading disclosures, for the politician trading tab.
 *
 * Reads join transactions to their 365-day performance row, which is the window the yearly figure
 * aggregates. Trades without one are kept -- a bond has no market price and a recent trade has no
 * completed year -- and counted separately so the page never presents an average as covering more
 * trades than it does.
 */

export interface TradeRecord {
  id: string;
  chamber: "house" | "senate";
  transactionDate: string | null;
  filedOn: string | null;
  owner: OwnerCode;
  ticker: string | null;
  assetName: string;
  assetType: string | null;
  transactionType: TransactionType;
  amountMin: number | null;
  amountMax: number | null;
  comment: string | null;
  sourceUrl: string | null;
  /** Percentage points over the benchmark at 365 days, before the sale sign flip. */
  alpha: number | null;
  tradeReturn: number | null;
  benchmarkReturn: number | null;
}

export interface TradingYear {
  year: number;
  chamber: string;
  tradeCount: number;
  purchaseCount: number;
  saleCount: number;
  tickerCount: number;
  disclosedMin: number;
  disclosedMax: number;
  scoredTradeCount: number;
  avgAlpha: number | null;
  avgTradeReturn: number | null;
  avgBenchmarkReturn: number | null;
}

export interface FilingCoverage {
  total: number;
  parsed: number;
  /** Filings that exist but could not be read. Surfaced so a gap never reads as "did not trade". */
  unreadable: number;
  byStatus: Record<string, number>;
}

export interface PoliticianTrading {
  trades: TradeRecord[];
  years: TradingYear[];
  coverage: FilingCoverage;
}

interface TransactionRow {
  id: string;
  chamber: "house" | "senate";
  transaction_date: string | null;
  filed_on: string | null;
  owner: string;
  ticker: string | null;
  asset_name: string;
  asset_type: string | null;
  transaction_type: string;
  amount_min: string | number | null;
  amount_max: string | number | null;
  comment: string | null;
  source_url: string | null;
  stock_trade_returns?: Array<{
    window_days: number;
    alpha: string | number;
    trade_return: string | number;
    benchmark_return: string | number;
  }>;
}

interface YearRow {
  year: number;
  chamber: string;
  trade_count: number;
  purchase_count: number;
  sale_count: number;
  ticker_count: number;
  disclosed_min: string | number | null;
  disclosed_max: string | number | null;
  scored_trade_count: number;
  avg_alpha: string | number | null;
  avg_trade_return: string | number | null;
  avg_benchmark_return: string | number | null;
}

/** PostgREST returns numeric columns as strings; every read of one goes through here. */
function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const EMPTY: PoliticianTrading = {
  trades: [],
  years: [],
  coverage: { total: 0, parsed: 0, unreadable: 0, byStatus: {} },
};

export async function fetchPoliticianTrading(politicianId: string, limit = 500): Promise<PoliticianTrading> {
  const filter = `politician_id=eq.${encodeURIComponent(politicianId)}`;

  const [transactions, years, filings] = await Promise.all([
    fetchSupabaseRows<TransactionRow>(
      "stock_transactions",
      `${filter}&order=transaction_date.desc.nullslast,id.asc&limit=${limit}`,
      {
        // The embedded resource is filtered to the 365-day window so a trade carries one score
        // rather than four rows the caller has to sift.
        select:
          "id,chamber,transaction_date,filed_on,owner,ticker,asset_name,asset_type,transaction_type,amount_min,amount_max,comment,source_url,stock_trade_returns(window_days,alpha,trade_return,benchmark_return)",
        tags: [STOCKS_CACHE_TAG],
      },
    ).catch(() => [] as TransactionRow[]),

    fetchSupabaseRows<YearRow>("stock_yearly_performance", `${filter}&order=year.desc`, {
      select:
        "year,chamber,trade_count,purchase_count,sale_count,ticker_count,disclosed_min,disclosed_max,scored_trade_count,avg_alpha,avg_trade_return,avg_benchmark_return",
      tags: [STOCKS_CACHE_TAG],
    }).catch(() => [] as YearRow[]),

    fetchSupabaseRows<{ status: string }>("stock_filings", `${filter}&order=id.asc`, {
      select: "status",
      tags: [STOCKS_CACHE_TAG],
      paginateAll: true,
    }).catch(() => [] as Array<{ status: string }>),
  ]);

  if (transactions.length === 0 && filings.length === 0) return EMPTY;

  const byStatus: Record<string, number> = {};
  for (const filing of filings) byStatus[filing.status] = (byStatus[filing.status] || 0) + 1;

  return {
    trades: transactions.map((row) => {
      const yearly = row.stock_trade_returns?.find((entry) => entry.window_days === 365);
      return {
        id: row.id,
        chamber: row.chamber,
        transactionDate: row.transaction_date,
        filedOn: row.filed_on,
        owner: row.owner as OwnerCode,
        ticker: row.ticker,
        assetName: row.asset_name,
        assetType: row.asset_type,
        transactionType: row.transaction_type as TransactionType,
        amountMin: num(row.amount_min),
        amountMax: num(row.amount_max),
        comment: row.comment,
        sourceUrl: row.source_url,
        alpha: yearly ? num(yearly.alpha) : null,
        tradeReturn: yearly ? num(yearly.trade_return) : null,
        benchmarkReturn: yearly ? num(yearly.benchmark_return) : null,
      };
    }),

    years: years.map((row) => ({
      year: row.year,
      chamber: row.chamber,
      tradeCount: row.trade_count,
      purchaseCount: row.purchase_count,
      saleCount: row.sale_count,
      tickerCount: row.ticker_count,
      disclosedMin: num(row.disclosed_min) ?? 0,
      disclosedMax: num(row.disclosed_max) ?? 0,
      scoredTradeCount: row.scored_trade_count,
      avgAlpha: num(row.avg_alpha),
      avgTradeReturn: num(row.avg_trade_return),
      avgBenchmarkReturn: num(row.avg_benchmark_return),
    })),

    coverage: {
      total: filings.length,
      parsed: byStatus.parsed || 0,
      unreadable: filings.length - (byStatus.parsed || 0),
      byStatus,
    },
  };
}

/** Whether any trading data exists at all, for deciding if the tab is worth linking. */
export async function hasStoredTrading(politicianId: string) {
  const rows = await fetchSupabaseRows<{ id: string }>(
    "stock_transactions",
    `politician_id=eq.${encodeURIComponent(politicianId)}&limit=1`,
    { select: "id", tags: [STOCKS_CACHE_TAG] },
  ).catch(() => [] as Array<{ id: string }>);

  return rows.length > 0;
}
