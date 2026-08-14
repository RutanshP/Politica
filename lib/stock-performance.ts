import { isSale, type TransactionType } from "@/lib/stock-disclosures";

/**
 * Trading performance, measured against the market.
 *
 * A portfolio return is not computable from these disclosures and this file does not attempt one.
 * Filings report a dollar band, never an amount, and never a share count, so position sizes are
 * unknown and any percentage built on them is an invention. What *is* fully determined by the data
 * is whether a disclosed trade beat simply holding the index over a fixed window -- that needs only
 * the date and the ticker. Everything here computes that, and nothing here multiplies a band.
 */

/** Windows a trade is scored over. 365 is what the yearly figure aggregates. */
export const RETURN_WINDOWS = [30, 90, 180, 365] as const;

export const BENCHMARK_TICKER = "SPY";

export interface PricePoint {
  date: string;
  close: number;
}

export interface TradeReturn {
  windowDays: number;
  entryPrice: number;
  exitPrice: number;
  benchmarkEntry: number;
  benchmarkExit: number;
  tradeReturn: number;
  benchmarkReturn: number;
  /** Percentage points of trade return over benchmark return, before any sign convention. */
  alpha: number;
}

function percentChange(from: number, to: number) {
  if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to)) return null;
  return ((to - from) / from) * 100;
}

/** Date shifted by whole days, as an ISO date string. */
export function shiftDate(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * The close on or nearest after a date, within a tolerance.
 *
 * Markets are shut on the day of plenty of disclosed trades -- weekends, holidays, and any date a
 * member wrote down loosely. Taking the next available session is the standard resolution; a
 * tolerance stops a delisted ticker from silently matching a price months away and producing a
 * return that describes a different period entirely.
 */
export function priceOnOrAfter(series: PricePoint[], date: string, toleranceDays = 7): PricePoint | null {
  const limit = shiftDate(date, toleranceDays);
  if (!limit) return null;

  let best: PricePoint | null = null;
  for (const point of series) {
    if (point.date < date || point.date > limit) continue;
    if (!best || point.date < best.date) best = point;
  }

  return best;
}

/**
 * A trade's performance against the benchmark over each window.
 *
 * A window whose exit price is missing is omitted rather than approximated: a trade made two months
 * ago has no 365-day outcome yet, and inventing one from the latest available price would report a
 * partial period as a full year.
 */
export function computeTradeReturns(input: {
  transactionDate: string;
  prices: PricePoint[];
  benchmark: PricePoint[];
  windows?: readonly number[];
}): TradeReturn[] {
  const entry = priceOnOrAfter(input.prices, input.transactionDate);
  const benchmarkEntry = priceOnOrAfter(input.benchmark, input.transactionDate);
  if (!entry || !benchmarkEntry) return [];

  const results: TradeReturn[] = [];

  for (const windowDays of input.windows ?? RETURN_WINDOWS) {
    const target = shiftDate(input.transactionDate, windowDays);
    if (!target) continue;

    const exit = priceOnOrAfter(input.prices, target);
    const benchmarkExit = priceOnOrAfter(input.benchmark, target);
    if (!exit || !benchmarkExit) continue;

    const tradeReturn = percentChange(entry.close, exit.close);
    const benchmarkReturn = percentChange(benchmarkEntry.close, benchmarkExit.close);
    if (tradeReturn === null || benchmarkReturn === null) continue;

    results.push({
      windowDays,
      entryPrice: entry.close,
      exitPrice: exit.close,
      benchmarkEntry: benchmarkEntry.close,
      benchmarkExit: benchmarkExit.close,
      tradeReturn: round2(tradeReturn),
      benchmarkReturn: round2(benchmarkReturn),
      alpha: round2(tradeReturn - benchmarkReturn),
    });
  }

  return results;
}

/**
 * Alpha oriented so that positive always means the trade was well timed.
 *
 * A purchase scores its raw alpha. A sale is flipped: selling before a stock underperforms is a good
 * decision, and leaving the sign alone would record that as a loss. Without this the two halves of a
 * member's activity cancel each other and the yearly figure trends to zero regardless of skill.
 */
export function timingAlpha(transactionType: TransactionType, alpha: number) {
  return isSale(transactionType) ? -alpha : alpha;
}

export interface ScoredTrade {
  year: number;
  transactionType: TransactionType;
  ticker: string | null;
  amountMin: number | null;
  amountMax: number | null;
  alpha?: number | null;
  tradeReturn?: number | null;
  benchmarkReturn?: number | null;
}

export interface YearlyPerformance {
  year: number;
  tradeCount: number;
  purchaseCount: number;
  saleCount: number;
  tickerCount: number;
  /** Summed band bounds. Reported as a range, never as one number. */
  disclosedMin: number;
  disclosedMax: number;
  /** Trades with a computable 365-day outcome. Always <= tradeCount. */
  scoredTradeCount: number;
  avgAlpha: number | null;
  avgTradeReturn: number | null;
  avgBenchmarkReturn: number | null;
}

/**
 * Per-year summary of a member's disclosed trading.
 *
 * scoredTradeCount is carried separately from tradeCount on purpose: bonds and private holdings have
 * no market price and recent trades have no completed window, so the average is over a subset. A
 * page showing "31 trades" beside an average drawn from 12 of them would overstate what the number
 * covers.
 */
export function aggregateYearly(trades: ScoredTrade[]): YearlyPerformance[] {
  const byYear = new Map<number, ScoredTrade[]>();
  for (const trade of trades) {
    if (!Number.isFinite(trade.year)) continue;
    byYear.set(trade.year, [...(byYear.get(trade.year) ?? []), trade]);
  }

  const years: YearlyPerformance[] = [];

  for (const [year, rows] of byYear) {
    const scored = rows.filter((row) => typeof row.alpha === "number" && Number.isFinite(row.alpha));
    const tickers = new Set(rows.map((row) => row.ticker).filter(Boolean));

    years.push({
      year,
      tradeCount: rows.length,
      purchaseCount: rows.filter((row) => row.transactionType === "purchase").length,
      saleCount: rows.filter((row) => isSale(row.transactionType)).length,
      tickerCount: tickers.size,
      disclosedMin: sum(rows.map((row) => row.amountMin)),
      disclosedMax: sum(rows.map((row) => row.amountMax)),
      scoredTradeCount: scored.length,
      avgAlpha: scored.length
        ? round2(mean(scored.map((row) => timingAlpha(row.transactionType, row.alpha as number))))
        : null,
      avgTradeReturn: average(scored.map((row) => row.tradeReturn)),
      avgBenchmarkReturn: average(scored.map((row) => row.benchmarkReturn)),
    });
  }

  return years.sort((left, right) => right.year - left.year);
}

function sum(values: Array<number | null | undefined>) {
  return values.reduce<number>((total, value) => total + (typeof value === "number" ? value : 0), 0);
}

function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function average(values: Array<number | null | undefined>) {
  const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return usable.length ? round2(mean(usable)) : null;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
