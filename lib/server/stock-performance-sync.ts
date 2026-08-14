import {
  PriceProviderError,
  fetchDailyCloses,
  isPriceProviderConfigured,
  providerRateLimitPerMinute,
} from "@/lib/adapters/stock-prices";
import {
  BENCHMARK_TICKER,
  RETURN_WINDOWS,
  computeTradeReturns,
  type PricePoint,
} from "@/lib/stock-performance";
import { fetchSupabaseRows, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";

/**
 * Scores stored trades against the market.
 *
 * Split from the disclosure sync because the two have completely different constraints: disclosures
 * come from government systems with no quota, while prices come from a rate-limited provider at
 * roughly eight symbols a minute. Running them together would put the whole disclosure load behind
 * the slowest external dependency in the system.
 *
 * Symbols are processed most-needed-first and the run is bounded, so repeated calls converge without
 * a cursor -- the same pattern the vote refresh uses.
 */

export interface PerformanceSyncResult {
  configured: boolean;
  symbolsConsidered: number;
  symbolsPriced: number;
  tradesScored: number;
  pricePointsStored: number;
  skipped: string[];
  errors: string[];
}

interface TransactionRow {
  id: string;
  ticker: string;
  transaction_date: string;
}

interface PriceRow {
  ticker: string;
  price_date: string;
  close: number;
}

interface ReturnRow {
  transaction_id: string;
  window_days: number;
  entry_price: number;
  exit_price: number;
  benchmark_entry: number;
  benchmark_exit: number;
  trade_return: number;
  benchmark_return: number;
  alpha: number;
  computed_at: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Cached closes for one symbol, as stored by an earlier run. */
async function loadStoredPrices(ticker: string): Promise<PricePoint[]> {
  const rows = await fetchSupabaseRows<PriceRow>(
    "stock_prices",
    `ticker=eq.${encodeURIComponent(ticker)}&order=price_date.asc`,
    { select: "ticker,price_date,close", cache: "no-store", paginateAll: true, paginateTiebreaker: null },
  ).catch(() => [] as PriceRow[]);

  return rows.map((row) => ({ date: row.price_date, close: Number(row.close) }));
}

/**
 * The benchmark series, from cache when it is already complete enough.
 *
 * Every trade needs it, so refetching per run would spend a large share of the quota on one symbol.
 */
async function loadBenchmark(): Promise<{ series: PricePoint[]; fetched: boolean }> {
  const stored = await loadStoredPrices(BENCHMARK_TICKER);
  // A few hundred points means an earlier run was interrupted; a full history is ~3,500.
  if (stored.length > 2000) return { series: stored, fetched: false };

  const series = await fetchDailyCloses(BENCHMARK_TICKER);
  return { series, fetched: true };
}

function priceRows(ticker: string, points: PricePoint[]): PriceRow[] {
  return points.map((point) => ({ ticker, price_date: point.date, close: point.close }));
}

/**
 * Computes and stores returns for trades that do not have them yet.
 *
 * `limit` bounds how many symbols one invocation touches, since a route has a 300s budget and the
 * provider allows roughly eight lookups a minute.
 */
export async function syncStockPerformance(input?: {
  limit?: number;
  dryRun?: boolean;
}): Promise<PerformanceSyncResult> {
  const result: PerformanceSyncResult = {
    configured: isPriceProviderConfigured(),
    symbolsConsidered: 0,
    symbolsPriced: 0,
    tradesScored: 0,
    pricePointsStored: 0,
    skipped: [],
    errors: [],
  };

  // Reported rather than thrown: the disclosure half of this feature is complete and useful without
  // prices, and a hard failure here would make the whole sync look broken.
  if (!result.configured) {
    result.errors.push("No stock price API key configured (POLITICA_STOCK_PRICE_API_KEY); returns not computed");
    return result;
  }

  const transactions = await fetchSupabaseRows<TransactionRow>(
    "stock_transactions",
    "ticker=not.is.null&transaction_date=not.is.null&order=transaction_date.desc",
    { select: "id,ticker,transaction_date", cache: "no-store", paginateAll: true },
  );

  const scored = new Set(
    (
      await fetchSupabaseRows<{ transaction_id: string }>(
        "stock_trade_returns",
        `window_days=eq.${RETURN_WINDOWS[0]}&order=transaction_id.asc`,
        { select: "transaction_id", cache: "no-store", paginateAll: true, paginateTiebreaker: null },
      ).catch(() => [] as Array<{ transaction_id: string }>)
    ).map((row) => row.transaction_id),
  );

  const pendingByTicker = new Map<string, TransactionRow[]>();
  for (const transaction of transactions) {
    if (scored.has(transaction.id)) continue;
    pendingByTicker.set(transaction.ticker, [...(pendingByTicker.get(transaction.ticker) ?? []), transaction]);
  }

  result.symbolsConsidered = pendingByTicker.size;
  if (pendingByTicker.size === 0) return result;

  let benchmark: PricePoint[];
  try {
    const loaded = await loadBenchmark();
    benchmark = loaded.series;
    if (loaded.fetched && !input?.dryRun && benchmark.length > 0) {
      await upsertSupabaseRowsInChunks("stock_prices", priceRows(BENCHMARK_TICKER, benchmark), "ticker,price_date", 500);
      result.pricePointsStored += benchmark.length;
    }
  } catch (error) {
    result.errors.push(`benchmark: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }

  if (benchmark.length === 0) {
    result.errors.push("benchmark series was empty; cannot score trades");
    return result;
  }

  // Most-needed first, so a bounded run always makes the largest dent it can.
  const symbols = [...pendingByTicker.entries()]
    .sort((left, right) => right[1].length - left[1].length)
    .slice(0, input?.limit ?? 25);

  const delay = Math.ceil(60_000 / providerRateLimitPerMinute());

  for (const [ticker, pending] of symbols) {
    let series: PricePoint[];
    try {
      series = await fetchDailyCloses(ticker);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${ticker}: ${message}`);
      // A quota error will hit every remaining symbol identically, so stop rather than burn the
      // rest of the run recording the same failure.
      if (error instanceof PriceProviderError && /limit|quota|frequency/i.test(message)) break;
      await sleep(delay);
      continue;
    }

    if (series.length === 0) {
      // Not an error: plenty of disclosed assets are bonds, funds or private holdings with no
      // market price. The UI reports these as unscored rather than as a zero return.
      result.skipped.push(ticker);
      await sleep(delay);
      continue;
    }

    result.symbolsPriced += 1;

    const returnRows: ReturnRow[] = [];
    const usedDates = new Set<string>();
    const now = new Date().toISOString();

    for (const transaction of pending) {
      const computed = computeTradeReturns({
        transactionDate: transaction.transaction_date,
        prices: series,
        benchmark,
      });

      for (const row of computed) {
        returnRows.push({
          transaction_id: transaction.id,
          window_days: row.windowDays,
          entry_price: row.entryPrice,
          exit_price: row.exitPrice,
          benchmark_entry: row.benchmarkEntry,
          benchmark_exit: row.benchmarkExit,
          trade_return: row.tradeReturn,
          benchmark_return: row.benchmarkReturn,
          alpha: row.alpha,
          computed_at: now,
        });
      }

      // Only the points a computation actually used are persisted. Storing each symbol's full
      // history would be roughly 3,500 rows per ticker across thousands of tickers, for a table
      // that exists only to save the provider quota on a rerun.
      if (computed.length > 0) {
        usedDates.add(transaction.transaction_date);
        for (const window of RETURN_WINDOWS) {
          const target = new Date(`${transaction.transaction_date}T00:00:00Z`);
          target.setUTCDate(target.getUTCDate() + window);
          usedDates.add(target.toISOString().slice(0, 10));
        }
      }
    }

    if (!input?.dryRun && returnRows.length > 0) {
      await upsertSupabaseRowsInChunks("stock_trade_returns", returnRows, "transaction_id,window_days", 500);

      const keep = series.filter((point) => usedDates.has(point.date));
      if (keep.length > 0) {
        await upsertSupabaseRowsInChunks("stock_prices", priceRows(ticker, keep), "ticker,price_date", 500);
        result.pricePointsStored += keep.length;
      }
    }

    result.tradesScored += new Set(returnRows.map((row) => row.transaction_id)).size;
    await sleep(delay);
  }

  return result;
}
