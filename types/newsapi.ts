export interface EventRegistryArticleSource {
  title?: string | null;
  uri?: string | null;
}

export interface EventRegistryArticle {
  title?: string | null;
  body?: string | null;
  url?: string | null;
  date?: string | null;
  dateTime?: string | null;
  source?: EventRegistryArticleSource | null;
  authors?: Array<{ name?: string | null }> | null;
}

export interface EventRegistryArticlesEnvelope {
  results?: EventRegistryArticle[];
}

export interface EventRegistryResponse {
  articles?: EventRegistryArticlesEnvelope;
}
