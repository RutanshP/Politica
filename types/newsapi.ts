export interface NewsApiArticle {
  source?: { id?: string | null; name?: string | null };
  author?: string | null;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  publishedAt?: string | null;
  content?: string | null;
}

export interface NewsApiResponse {
  status?: string;
  totalResults?: number;
  articles?: NewsApiArticle[];
}
