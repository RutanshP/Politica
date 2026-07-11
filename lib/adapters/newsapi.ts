import type { EventRegistryArticle, EventRegistryResponse } from "@/types/newsapi";

const NEWS_API_BASE = process.env.POLITICA_NEWS_API_BASE_URL?.trim()
  || "https://eventregistry.org/api/v1";

function getNewsApiKey() {
  return process.env.POLITICA_NEWS_API_KEY?.trim() || "";
}

export function isNewsApiConfigured() {
  return Boolean(getNewsApiKey());
}

async function fetchNewsApiJson<T>(pathname: string, params?: Record<string, string | number | undefined>) {
  const url = new URL(`${NEWS_API_BASE}${pathname}`);

  url.searchParams.set("apiKey", getNewsApiKey());

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
    },
    next: { revalidate: 21600 },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`News API request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`);
  }

  return (await response.json()) as T;
}

export async function fetchTopPoliticalArticles(query: string) {
  const payload = await fetchNewsApiJson<EventRegistryResponse>("/article/getArticles", {
    resultType: "articles",
    keyword: query,
    keywordOper: "or",
    lang: "eng",
    articlesSortBy: "date",
    maxItems: 10,
  });

  return payload.articles?.results ?? [];
}

export function dedupeNewsArticles(items: EventRegistryArticle[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.url || item.title || "";
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
