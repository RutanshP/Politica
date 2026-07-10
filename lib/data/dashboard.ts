import { getAnalyticsData } from "@/lib/data/analytics";
import { getBillsData, getRecentlyPassedBills } from "@/lib/data/bills";
import { getNewsData } from "@/lib/data/news";

export async function getDashboardData() {
  const [{ summary, source: analyticsSource }, { bills, source: billsSource }, { news }] =
    await Promise.all([getAnalyticsData(), getBillsData(), getNewsData()]);

  return {
    source:
      billsSource === "supabase"
      || analyticsSource === "supabase-derived"
        ? "supabase-derived"
        : billsSource === "unconfigured"
          ? "unconfigured"
          : "unavailable",
    analytics: summary,
    feed: {
      trendingBills: bills.slice(0, 4),
      recentlyPassed: getRecentlyPassedBills(bills),
      upcomingVotes: bills
        .filter((bill) => bill.status === "On Floor" || bill.status === "Passed Chamber")
        .slice(0, 4)
        .map((bill) => ({
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
