import { getBillsData } from "@/lib/data/bills";
import { getCommitteesData } from "@/lib/data/committees";
import { getPoliticiansData } from "@/lib/data/politicians";

type SeriesPoint = { label: string; value: number };

export type AnalyticsDataSource = "live-derived" | "unconfigured" | "unavailable";

function emptySeries(labels: string[]) {
  return labels.map((label) => ({ label, value: 0 }));
}

function buildMonthlySeries(values: string[]) {
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short" });
  const counts = new Map<string, number>();

  for (const value of values) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    const label = formatter.format(date);
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  return [...counts.entries()]
    .slice(-6)
    .map(([label, count]) => ({ label, value: count }));
}

function withFallbackSeries(series: SeriesPoint[], labels: string[]) {
  return series.length > 0 ? series : emptySeries(labels);
}

export async function getAnalyticsData() {
  const [billsData, committeesData, politiciansData] = await Promise.all([
    getBillsData(),
    getCommitteesData(),
    getPoliticiansData(),
  ]);

  const allSources = [billsData.source, committeesData.source, politiciansData.source];
  const hasLiveData =
    billsData.bills.length > 0
    || committeesData.committees.length > 0
    || politiciansData.politicians.length > 0;

  const source: AnalyticsDataSource = hasLiveData
    ? "live-derived"
    : allSources.every((item) => item === "unconfigured")
      ? "unconfigured"
      : "unavailable";

  const activeBills = billsData.bills.length;
  const upcomingVotes = billsData.bills.filter((bill) =>
    bill.status === "On Floor"
    || bill.status === "Passed Chamber"
    || bill.status === "Sent to President",
  ).length;
  const committees = committeesData.committees.length;
  const watchlistHits =
    billsData.bills.filter((bill) => bill.status !== "Introduced").length
    + committeesData.committees.filter((committee) => committee.activeBillIds.length > 0).length;

  const activitySeries = withFallbackSeries(
    ([
      ["Introduced", billsData.bills.filter((bill) => bill.status === "Introduced").length],
      ["Committee", billsData.bills.filter((bill) => bill.status === "In Committee").length],
      ["Floor", billsData.bills.filter((bill) => bill.status === "On Floor").length],
      ["Passed", billsData.bills.filter((bill) => bill.status === "Passed Chamber").length],
      ["Signed", billsData.bills.filter((bill) => bill.status === "Signed").length],
    ] as Array<[string, number]>).map(([label, value]) => ({ label, value })),
    ["Introduced", "Committee", "Floor", "Passed", "Signed"],
  );

  const voteCadenceSeries = withFallbackSeries(
    billsData.bills
      .slice(0, 5)
      .map((bill) => ({ label: bill.number, value: bill.stats.votes })),
    ["Bill 1", "Bill 2", "Bill 3", "Bill 4", "Bill 5"],
  );

  const committeeSeries = withFallbackSeries(
    committeesData.committees
      .slice(0, 5)
      .map((committee) => ({
        label: committee.name.split(" ").slice(0, 2).join(" "),
        value: committee.activeBillIds.length,
      })),
    ["Cmte 1", "Cmte 2", "Cmte 3", "Cmte 4", "Cmte 5"],
  );

  const alertSeries = withFallbackSeries(
    politiciansData.politicians
      .slice(0, 5)
      .map((politician) => ({
        label: politician.name.split(" ").slice(-1)[0] || politician.name,
        value: politician.stats.billsIntroduced,
      })),
    ["M1", "M2", "M3", "M4", "M5"],
  );

  const introductionsSeries = withFallbackSeries(
    buildMonthlySeries(billsData.bills.map((bill) => bill.introducedAt)),
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
  );

  const totalAlignment = politiciansData.politicians.reduce(
    (sum, politician) => sum + politician.stats.votesWithParty,
    0,
  );
  const totalCrossParty = politiciansData.politicians.reduce(
    (sum, politician) => sum + politician.stats.votesAgainstParty,
    0,
  );
  const politicianCount = Math.max(politiciansData.politicians.length, 1);

  return {
    source,
    summary: {
      activeBills,
      upcomingVotes,
      committees,
      watchlistHits,
      activitySeries,
      voteCadenceSeries,
      committeeSeries,
      alertSeries,
      introductionsSeries,
      partisanSeries: [
        {
          label: "With party",
          value: Math.round(totalAlignment / politicianCount),
        },
        {
          label: "Cross-party",
          value: Math.round(totalCrossParty / politicianCount),
        },
      ],
    },
  };
}
