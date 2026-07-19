import {
  getSupabaseSchema,
  getSupabaseSecretKey,
  getSupabaseUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/config";

function buildHeaders(extra?: Record<string, string>) {
  const secret = getSupabaseSecretKey();
  const schema = getSupabaseSchema();

  return {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    Accept: "application/json",
    ...(schema ? { "Accept-Profile": schema, "Content-Profile": schema } : {}),
    ...extra,
  };
}

function applyRestQuery(url: URL, query?: string, includeSelect = false, select?: string) {
  if (includeSelect) {
    url.searchParams.set("select", "*");
  }

  if (select) {
    url.searchParams.set("select", select);
  }

  if (!query) {
    return url;
  }

  for (const chunk of query.split("&")) {
    // Split on the first "=" only: an or()/and() combinator's value legitimately contains
    // further "=" characters (e.g. "or=(sponsor_id.eq.x,sponsor_name.eq.y)" does not, but a
    // caller building one with "sponsor_id=eq.x" by mistake would) -- chunk.split("=") silently
    // discarded everything past the second "=", corrupting the filter into a truncated key with
    // no PostgREST operator, which PostgREST then rejected outright.
    const eqIndex = chunk.indexOf("=");
    const key = eqIndex === -1 ? chunk : chunk.slice(0, eqIndex);
    const value = eqIndex === -1 ? "" : chunk.slice(eqIndex + 1);
    if (key) {
      url.searchParams.set(key, decodeURIComponent(value));
    }
  }

  return url;
}

function buildRestUrl(pathname: string, query?: string, select?: string) {
  const base = getSupabaseUrl();
  return applyRestQuery(new URL(`${base}/rest/v1/${pathname}`), query, true, select).toString();
}

function buildRestMutationUrl(pathname: string, query?: string) {
  const base = getSupabaseUrl();
  return applyRestQuery(new URL(`${base}/rest/v1/${pathname}`), query, false).toString();
}

function buildRpcUrl(functionName: string) {
  const base = getSupabaseUrl();
  return new URL(`${base}/rest/v1/rpc/${functionName}`).toString();
}

export const SUPABASE_READ_REVALIDATE_SECONDS = 21600;

export type SupabaseReadCache = "default" | "no-store";

interface SupabaseReadOptions {
  cache?: SupabaseReadCache;
  select?: string;
  /**
   * Cache tags for on-demand invalidation via revalidateTag() from the sync routes.
   * Without a tag, cached reads only refresh on the revalidate timer.
   */
  tags?: string[];
}

/**
 * Read paths are cached in Next's Data Cache and invalidated by tag when a sync writes.
 * `no-store` is reserved for the sync pipelines, which must observe current DB state to
 * compute diffs -- a cached read there would make them recompute against stale rows.
 */
function buildReadInit(options?: SupabaseReadOptions): RequestInit {
  if (options?.cache === "no-store") {
    return { headers: buildHeaders(), cache: "no-store" };
  }

  return {
    headers: buildHeaders(),
    next: {
      revalidate: SUPABASE_READ_REVALIDATE_SECONDS,
      ...(options?.tags?.length ? { tags: options.tags } : {}),
    },
  };
}

async function readJson<T>(url: string, init: RequestInit) {
  const response = await fetch(url, init);

  if (!response.ok) {
    // Include PostgREST's error body: a bare "500 Internal Server Error" gives no way to tell a
    // statement timeout from a bad column from a malformed filter.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Supabase read failed: ${response.status} ${response.statusText}${detail ? ` - ${detail.slice(0, 300)}` : ""}`,
    );
  }

  return (await response.json()) as T;
}

const PAGINATE_ALL_CONCURRENCY = 6;

export async function fetchSupabaseRows<T>(
  pathname: string,
  query?: string,
  options?: SupabaseReadOptions & {
    paginateAll?: boolean;
    pageSize?: number;
  },
) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured");
  }

  const init = buildReadInit(options);

  if (!options?.paginateAll) {
    return readJson<T[]>(buildRestUrl(pathname, query, options?.select), init);
  }

  if (query && /(^|&)limit=|(^|&)offset=/.test(query)) {
    throw new Error("Supabase paginated reads cannot be combined with explicit limit/offset query params");
  }

  const pageSize = Math.max(1, options.pageSize || 250);

  // Ask for the total alongside the first page so the remaining pages can be fetched in
  // parallel. The previous implementation walked pages strictly serially -- page N+1 only
  // began after page N returned -- which made a full-table read take (rows / pageSize)
  // round trips end to end.
  const firstUrl = buildRestUrl(pathname, [query, "offset=0", `limit=${pageSize}`].filter(Boolean).join("&"), options?.select);
  const firstResponse = await fetch(firstUrl, {
    ...init,
    headers: buildHeaders({
      Prefer: "count=planned",
      Range: `0-${pageSize - 1}`,
      "Range-Unit": "items",
    }),
  });

  if (!firstResponse.ok) {
    throw new Error(`Supabase read failed: ${firstResponse.status} ${firstResponse.statusText}`);
  }

  const firstPage = (await firstResponse.json()) as T[];
  if (firstPage.length < pageSize) {
    return firstPage;
  }

  const total = Number(firstResponse.headers?.get("content-range")?.split("/")[1]);
  const rows = [...firstPage];

  if (!Number.isFinite(total) || total <= pageSize) {
    // No usable total (a planned count can be absent on a never-analyzed table): fall back to
    // walking pages serially until a short page, which is always correct if slower.
    for (let offset = pageSize; ; offset += pageSize) {
      const pagedQuery = [query, `offset=${offset}`, `limit=${pageSize}`].filter(Boolean).join("&");
      const pageRows = await readJson<T[]>(buildRestUrl(pathname, pagedQuery, options?.select), init);
      rows.push(...pageRows);
      if (pageRows.length < pageSize) {
        return rows;
      }
    }
  }

  const offsets: number[] = [];
  for (let offset = pageSize; offset < total; offset += pageSize) {
    offsets.push(offset);
  }

  const pages: T[][] = new Array(offsets.length);
  for (let index = 0; index < offsets.length; index += PAGINATE_ALL_CONCURRENCY) {
    const window = offsets.slice(index, index + PAGINATE_ALL_CONCURRENCY);
    const settled = await Promise.all(
      window.map((offset) => {
        const pagedQuery = [query, `offset=${offset}`, `limit=${pageSize}`].filter(Boolean).join("&");
        return readJson<T[]>(buildRestUrl(pathname, pagedQuery, options?.select), init);
      }),
    );
    for (let slot = 0; slot < settled.length; slot += 1) {
      pages[index + slot] = settled[slot];
    }
  }

  for (const page of pages) {
    rows.push(...(page || []));
  }

  // `count=planned` is an estimate, so the table may have grown past it. Keep reading from
  // the end until a short page confirms we have everything.
  for (let offset = pageSize + offsets.length * pageSize; ; offset += pageSize) {
    const pagedQuery = [query, `offset=${offset}`, `limit=${pageSize}`].filter(Boolean).join("&");
    const pageRows = await readJson<T[]>(buildRestUrl(pathname, pagedQuery, options?.select), init);
    rows.push(...pageRows);
    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rows;
}

/**
 * Calls a STABLE Postgres function over GET so the result lands in Next's Data Cache.
 * `invokeSupabaseRpc` uses POST, which Next never caches.
 */
export async function fetchSupabaseRpcRows<T>(
  functionName: string,
  args?: Record<string, string>,
  options?: SupabaseReadOptions,
) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured");
  }

  const url = new URL(buildRpcUrl(functionName));
  for (const [key, value] of Object.entries(args || {})) {
    url.searchParams.set(key, value);
  }
  if (options?.select) {
    url.searchParams.set("select", options.select);
  }

  return readJson<T[]>(url.toString(), buildReadInit(options));
}

export async function fetchSupabasePage<T>(
  pathname: string,
  query?: string,
  options?: SupabaseReadOptions & {
    limit: number;
    offset: number;
    /**
     * `exact` makes Postgres count every matching row on every page view. `planned` reads the
     * planner's estimate instead, which is enough to drive a pager and is materially cheaper on
     * a filtered predicate.
     */
    count?: "exact" | "planned";
  },
) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured");
  }

  const limit = Math.max(1, options?.limit || 20);
  const offset = Math.max(0, options?.offset || 0);
  const pagedQuery = [query, `offset=${offset}`, `limit=${limit}`]
    .filter(Boolean)
    .join("&");

  const init = buildReadInit(options);
  const response = await fetch(buildRestUrl(pathname, pagedQuery, options?.select), {
    ...init,
    headers: buildHeaders({
      Prefer: `count=${options?.count || "exact"}`,
      Range: `${offset}-${offset + limit - 1}`,
      "Range-Unit": "items",
    }),
  });

  if (!response.ok) {
    throw new Error(`Supabase read failed: ${response.status} ${response.statusText}`);
  }

  const rows = (await response.json()) as T[];
  const contentRange = response.headers.get("content-range") || "";
  const totalText = contentRange.split("/")[1] || "";
  const total = Number(totalText);

  return {
    rows,
    total: Number.isFinite(total) ? total : rows.length,
  };
}

/**
 * PostgREST rejects a bulk insert whose objects do not all share the same keys (PGRST102), and
 * `JSON.stringify` silently drops `undefined` values -- so two rows built by different code paths
 * (e.g. a list-only bill vs a detailed one, or a placeholder politician vs a stored one) can end
 * up with different key sets in the same batch. Normalize every row to the union of all keys,
 * filling any it is missing with null.
 */
function normalizeRowKeys<T extends object>(rows: T[]): T[] {
  if (rows.length <= 1) {
    return rows;
  }

  const allKeys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if ((row as Record<string, unknown>)[key] !== undefined) {
        allKeys.add(key);
      }
    }
  }

  return rows.map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const key of allKeys) {
      const value = (row as Record<string, unknown>)[key];
      normalized[key] = value === undefined ? null : value;
    }
    return normalized as T;
  });
}

export async function upsertSupabaseRows<T extends object>(
  pathname: string,
  rows: T[],
  onConflict: string,
) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured");
  }

  const response = await fetch(buildRestMutationUrl(pathname, `on_conflict=${encodeURIComponent(onConflict)}`), {
    method: "POST",
    headers: buildHeaders({
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify(normalizeRowKeys(rows)),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase upsert failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`);
  }

  return (await response.json()) as T[];
}

export async function upsertSupabaseRowsInChunks<T extends object>(
  pathname: string,
  rows: T[],
  onConflict: string,
  chunkSize = 100,
) {
  const written: T[] = [];

  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const result = await upsertSupabaseRows(pathname, chunk, onConflict);
    written.push(...result);
  }

  return written;
}

export async function deleteSupabaseRows(pathname: string, query: string) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured");
  }

  const response = await fetch(buildRestMutationUrl(pathname, query), {
    method: "DELETE",
    headers: buildHeaders({
      Prefer: "return=minimal",
    }),
  });

  if (!response.ok) {
    throw new Error(`Supabase delete failed: ${response.status} ${response.statusText}`);
  }
}

export async function invokeSupabaseRpc<TResponse>(
  functionName: string,
  args?: Record<string, unknown>,
  options?: {
    cache?: "default" | "no-store";
  },
) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured");
  }

  const response = await fetch(buildRpcUrl(functionName), {
    method: "POST",
    headers: buildHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(args || {}),
    ...(options?.cache === "no-store"
      ? { cache: "no-store" as const }
      : { next: { revalidate: 21600 } }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase rpc failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`);
  }

  return await response.json() as TResponse;
}
