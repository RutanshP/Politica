import type { DataAvailability, DataFreshness } from "@/types/civic";

export interface StoredDataResult<T> {
  source: string;
  availability: DataAvailability;
  freshness: DataFreshness;
  error?: string;
  data: T;
}

export function buildFreshness(
  pipeline: string,
  syncedAt?: string,
  staleAfterHours = 24,
  detail?: string,
): DataFreshness {
  const timestamp = syncedAt ? Date.parse(syncedAt) : Number.NaN;
  const stale =
    !syncedAt
    || Number.isNaN(timestamp)
    || Date.now() - timestamp > staleAfterHours * 60 * 60 * 1000;

  return {
    pipeline,
    syncedAt,
    stale,
    detail,
  };
}

export function emptyResult<T>(
  source: string,
  pipeline: string,
  data: T,
  availability: DataAvailability,
  error?: string,
): StoredDataResult<T> {
  return {
    source,
    availability,
    freshness: buildFreshness(pipeline),
    error,
    data,
  };
}

export function withData<T>(
  source: string,
  pipeline: string,
  data: T,
  syncedAt?: string,
  options?: {
    staleAfterHours?: number;
    detail?: string;
    availability?: DataAvailability;
    error?: string;
  },
): StoredDataResult<T> {
  return {
    source,
    availability: options?.availability || "live",
    freshness: buildFreshness(
      pipeline,
      syncedAt,
      options?.staleAfterHours,
      options?.detail,
    ),
    error: options?.error,
    data,
  };
}
