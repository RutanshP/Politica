import type { NewsApiArticle, NewsApiResponse } from "@/types/newsapi";

const NEWS_API_BASE = process.env.POLITICA_NEWS_API_BASE_URL?.trim()
  || "https://newsapi.org/v2";

function getNewsApiKey() {
  return process.env.POLITICA_NEWS_API_KEY?.trim() || "";
}

export function isNewsApiConfigured() {
  return Boolean(getNewsApiKey());
}

async function fetchNewsApiJson<T>(pathname: string, params?: Record<string, string | number | undefined>) {
  const url = new URL(`${NEWS_API_BASE}${pathname}`);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Api-Key": getNewsApiKey(),
    },
    next: { revalidate: 21600 },
  });

  if (!response.ok) {
    throw new Error(`News API request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function fetchTopPoliticalArticles(query: string) {
  const payload = await fetchNewsApiJson<NewsApiResponse>("/everything", {
    q: query,
    pageSize: 20,
    language: "en",
    sortBy: "publishedAt",
  });

  return payload.articles ?? [];
}

export function dedupeNewsArticles(items: NewsApiArticle[]) {
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
