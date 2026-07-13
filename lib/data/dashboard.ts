import { getAnalyticsData } from "@/lib/data/analytics";
import { getDashboardBills } from "@/lib/data/bills";
import { getNewsData } from "@/lib/data/news";

export async function getDashboardData() {
  const [{ summary, source: analyticsSource }, bills, { news }] = await Promise.all([
    getAnalyticsData(),
    getDashboardBills(),
    getNewsData(),
  ]);

  return {
    source:
      bills.source === "supabase"
      || analyticsSource === "supabase-derived"
        ? "supabase-derived"
        : bills.source === "unconfigured"
          ? "unconfigured"
          : "unavailable",
    analytics: summary,
    feed: {
      trendingBills: bills.trending,
      recentlyPassed: bills.recentlyPassed,
      upcomingVotes: bills.upcomingVotes.map((bill) => ({
        id: `vote-${bill.id}`,
        billId: bill.id,
        billNumber: bill.number,
        title: bill.title,
        chamber: bill.chamber,
        dateLabel: bill.lastActionAt,
      })),
      news: news.slice(0, 3),
    },
  };
}
