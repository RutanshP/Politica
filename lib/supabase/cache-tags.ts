/**
 * Cache tags for Supabase reads.
 *
 * Read paths are cached in Next's Data Cache with a long revalidate window. Rather than
 * defeating that cache with `no-store` (which also forces every route to render dynamically),
 * the sync routes call revalidateTag() after they write, so cached reads refresh on write
 * instead of on every request.
 */
export const BILLS_CACHE_TAG = "politica:bills";
export const POLITICIANS_CACHE_TAG = "politica:politicians";
export const COMMITTEES_CACHE_TAG = "politica:committees";
export const VOTES_CACHE_TAG = "politica:votes";
export const NEWS_CACHE_TAG = "politica:news";
export const FINANCE_CACHE_TAG = "politica:finance";
export const FUNDING_GRAPH_CACHE_TAG = "politica:funding-graph";
export const SEARCH_CACHE_TAG = "politica:search";
export const SYNC_CACHE_TAG = "politica:sync";
export const ELECTIONS_CACHE_TAG = "politica:elections";

export const ALL_CACHE_TAGS = [
  BILLS_CACHE_TAG,
  POLITICIANS_CACHE_TAG,
  COMMITTEES_CACHE_TAG,
  VOTES_CACHE_TAG,
  NEWS_CACHE_TAG,
  FINANCE_CACHE_TAG,
  FUNDING_GRAPH_CACHE_TAG,
  SEARCH_CACHE_TAG,
  SYNC_CACHE_TAG,
  ELECTIONS_CACHE_TAG,
];
