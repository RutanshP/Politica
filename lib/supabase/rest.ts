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
    const [key, value = ""] = chunk.split("=");
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

export async function fetchSupabaseRows<T>(
  pathname: string,
  query?: string,
  options?: {
    cache?: "default" | "no-store";
    select?: string;
    paginateAll?: boolean;
    pageSize?: number;
  },
) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured");
  }

  const fetchOptions = {
    headers: buildHeaders(),
    ...(options?.cache === "no-store"
      ? { cache: "no-store" as const }
      : { next: { revalidate: 21600 } }),
  };

  if (!options?.paginateAll) {
    const response = await fetch(buildRestUrl(pathname, query, options?.select), fetchOptions);

    if (!response.ok) {
      throw new Error(`Supabase read failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T[];
  }

  if (query && /(^|&)limit=|(^|&)offset=/.test(query)) {
    throw new Error("Supabase paginated reads cannot be combined with explicit limit/offset query params");
  }

  const rows: T[] = [];
  const pageSize = Math.max(1, options.pageSize || 250);

  for (let offset = 0; ; offset += pageSize) {
    const pagedQuery = [query, `offset=${offset}`, `limit=${pageSize}`]
      .filter(Boolean)
      .join("&");
    const response = await fetch(buildRestUrl(pathname, pagedQuery, options?.select), fetchOptions);

    if (!response.ok) {
      throw new Error(`Supabase read failed: ${response.status} ${response.statusText}`);
    }

    const pageRows = (await response.json()) as T[];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rows;
}

export async function fetchSupabasePage<T>(
  pathname: string,
  query?: string,
  options?: {
    cache?: "default" | "no-store";
    select?: string;
    limit: number;
    offset: number;
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

  const response = await fetch(buildRestUrl(pathname, pagedQuery, options?.select), {
    headers: buildHeaders({
      Prefer: "count=exact",
      Range: `${offset}-${offset + limit - 1}`,
      "Range-Unit": "items",
    }),
    ...(options?.cache === "no-store"
      ? { cache: "no-store" as const }
      : { next: { revalidate: 21600 } }),
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
    body: JSON.stringify(rows),
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
