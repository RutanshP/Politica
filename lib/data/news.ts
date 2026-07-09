import { getBillsData } from "@/lib/data/bills";
import type { NewsItem } from "@/types/civic";

export type NewsDataSource = "live-derived" | "unconfigured" | "unavailable";

export async function getNewsData() {
  const { bills, source } = await getBillsData();

  if (source === "unconfigured") {
    return {
      source: "unconfigured" as NewsDataSource,
      news: [] as NewsItem[],
    };
  }

  if (source !== "live-congress") {
    return {
      source: "unavailable" as NewsDataSource,
      news: [] as NewsItem[],
    };
  }

  const news = bills.slice(0, 6).map<NewsItem>((bill, index) => ({
    id: `news-${bill.id}-${index + 1}`,
    headline: `${bill.number} moved: ${bill.title}`,
    source: "Congress.gov",
    publishedAt: bill.lastActionAt,
    relatedIds: [bill.id, bill.committeeId, bill.sponsorId],
    summary: bill.latestAction,
  }));

  return {
    source: "live-derived" as NewsDataSource,
    news,
  };
}
