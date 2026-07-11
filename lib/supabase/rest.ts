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

function applyRestQuery(url: URL, query?: string, includeSelect = false) {
  if (includeSelect) {
    url.searchParams.set("select", "*");
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

function buildRestUrl(pathname: string, query?: string) {
  const base = getSupabaseUrl();
  return applyRestQuery(new URL(`${base}/rest/v1/${pathname}`), query, true).toString();
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
  },
) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured");
  }

  const response = await fetch(buildRestUrl(pathname, query), {
    headers: buildHeaders(),
    ...(options?.cache === "no-store"
      ? { cache: "no-store" as const }
      : { next: { revalidate: 21600 } }),
  });

  if (!response.ok) {
    throw new Error(`Supabase read failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T[];
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
