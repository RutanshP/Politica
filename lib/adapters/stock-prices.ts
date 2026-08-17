import "server-only";

import type { PricePoint } from "@/lib/stock-performance";

/**
 * Daily closes, for scoring trades against the market.
 *
 * This needs a configured provider, which is a deliberate choice rather than an oversight. Every
 * keyless source was tested and none is usable from a server:
 *
 *   - Yahoo's chart endpoint answers curl but returns 429 to Node on every request regardless of
 *     headers, rate or host -- it is fingerprinting the client, not throttling the caller.
 *   - Stooq now gates its CSV behind a JavaScript proof-of-work challenge.
 *   - stockanalysis.com responds to Node but serves roughly six months of history, and these
 *     disclosures start in 2012.
 *
 * So prices are the one part of this pipeline with a hard external dependency. Nothing else needs
 * one: the disclosures themselves -- trades, tickers, holdings, timelines -- come from the
 * government systems and work with no key at all. Without POLITICA_STOCK_PRICE_API_KEY the trading
 * data is complete and only the performance columns stay empty, which the UI reports as an
 * unscored count rather than as zeros.
 */

export type PriceProvider = "twelvedata" | "alphavantage";

export function getPriceApiKey() {
  return process.env.POLITICA_STOCK_PRICE_API_KEY?.trim() || "";
}

export function getPriceProvider(): PriceProvider {
  const configured = process.env.POLITICA_STOCK_PRICE_PROVIDER?.trim().toLowerCase();
  return configured === "alphavantage" ? "alphavantage" : "twelvedata";
}

export function isPriceProviderConfigured() {
  return getPriceApiKey().length > 0;
}

/**
 * Requests per minute the free tiers allow. Twelve Data cuts off at 8/min and Alpha Vantage at 5,
 * and both answer an overrun with a 200 carrying an error body rather than a status code -- so the
 * limiter here is what keeps the backfill correct, not just polite.
 */
export function providerRateLimitPerMinute(provider: PriceProvider = getPriceProvider()) {
  return provider === "alphavantage" ? 5 : 8;
}

export class PriceProviderError extends Error {}

/**
 * The provider has no series for this symbol, and never will.
 *
 * Separated from a transient failure because the two want opposite handling: a timeout should be
 * retried, while a delisted ticker retried on every run spends quota on a guaranteed 404. X and PXD
 * -- US Steel and Pioneer, both acquired -- came back 404 in three consecutive batches.
 */
export class SymbolNotFoundError extends PriceProviderError {}

/**
 * Full daily close history for one symbol.
 *
 * Throws on a provider error rather than returning an empty series. An empty series is
 * indistinguishable from "this ticker has no prices", which would let a quota overrun be recorded
 * as thousands of unpriceable trades -- the failure mode this codebase has hit repeatedly by
 * swallowing errors into empty results.
 */
export async function fetchDailyCloses(symbol: string): Promise<PricePoint[]> {
  const key = getPriceApiKey();
  if (!key) throw new PriceProviderError("No stock price API key configured");

  return getPriceProvider() === "alphavantage"
    ? fetchAlphaVantage(symbol, key)
    : fetchTwelveData(symbol, key);
}

async function fetchTwelveData(symbol: string, key: string): Promise<PricePoint[]> {
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1day");
  // The disclosures begin in 2012; anything earlier has no trade to score.
  url.searchParams.set("start_date", "2011-06-01");
  url.searchParams.set("outputsize", "5000");
  url.searchParams.set("apikey", key);

  const response = await fetch(url, { cache: "no-store" });

  // 404 (not carried) and 400 (rejected as a symbol) are both permanent for this ticker. SUP came
  // back 400 in all five batches of a run and would have kept doing so nightly.
  if (response.status === 404 || response.status === 400) {
    throw new SymbolNotFoundError(`${symbol}: Twelve Data HTTP ${response.status}`);
  }

  // 429 is the rate limit. It must say so in words the caller matches on, or the run keeps walking
  // the remaining symbols at eight a minute while every one of them fails -- which cost ~19 minutes
  // of a backfill hammering an API that had already cut it off.
  if (response.status === 429) throw new PriceProviderError(`Twelve Data rate limit reached (HTTP 429)`);

  if (!response.ok) throw new PriceProviderError(`Twelve Data HTTP ${response.status}`);

  const payload = (await response.json()) as {
    status?: string;
    code?: number;
    message?: string;
    values?: Array<{ datetime?: string; close?: string }>;
  };

  // A quota overrun arrives as 200 with status:"error". So does an unknown symbol, under code 404.
  if (payload.status === "error") {
    const message = payload.message || "Twelve Data error";
    if (payload.code === 404 || /not found|not available|invalid symbol/i.test(message)) {
      throw new SymbolNotFoundError(`${symbol}: ${message}`);
    }
    throw new PriceProviderError(message);
  }
  if (!payload.values) return [];

  return payload.values
    .map((row) => ({ date: (row.datetime || "").slice(0, 10), close: Number(row.close) }))
    .filter((point) => point.date.length === 10 && Number.isFinite(point.close) && point.close > 0);
}

async function fetchAlphaVantage(symbol: string, key: string): Promise<PricePoint[]> {
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "TIME_SERIES_DAILY");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("outputsize", "full");
  url.searchParams.set("apikey", key);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new PriceProviderError(`Alpha Vantage HTTP ${response.status}`);

  const payload = (await response.json()) as Record<string, unknown>;

  if (payload["Error Message"]) throw new PriceProviderError(String(payload["Error Message"]));
  // The free tier reports exhaustion in a "Note"/"Information" field, again with a 200.
  if (payload.Note || payload.Information) {
    throw new PriceProviderError(String(payload.Note || payload.Information));
  }

  const series = payload["Time Series (Daily)"] as Record<string, Record<string, string>> | undefined;
  if (!series) return [];

  return Object.entries(series)
    .map(([date, row]) => ({ date, close: Number(row["4. close"]) }))
    .filter((point) => Number.isFinite(point.close) && point.close > 0);
}
