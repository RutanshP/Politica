import {
  fetchCongressMemberDetail,
  fetchCongressMembers,
  isCongressBillsConfigured,
} from "@/lib/adapters/congress";
import { getBillsData, isLiveBillsSource } from "@/lib/data/bills";
import { slugifySegment } from "@/lib/utils";
import type { Bill, Politician } from "@/types/civic";

export type PoliticianDataSource =
  | "live-congress-members"
  | "live-bill-derived"
  | "unconfigured"
  | "unavailable";

function buildPoliticianProfile(input: {
  id: string;
  name: string;
  title: string;
  party: string;
  state: string;
  district?: string;
  sponsoredBills: Bill[];
}) {
  return {
    id: input.id,
    slug: slugifySegment(input.name),
    name: input.name,
    title: input.title,
    party: input.party,
    state: input.state,
    district: input.district,
    biography:
      `${input.title} from ${input.state}. Profile is synced from live congressional data and sponsored legislation.`,
    born: "Not available from configured sources",
    education: "Not available from configured sources",
    occupation: "Public official",
    website: "www.congress.gov/member",
    officePhone: "Not available from configured sources",
    officeAddress: "Office address not available from configured sources",
    nextElection: "Election calendar not connected",
    stats: {
      votesWithParty: 0,
      votesAgainstParty: 0,
      attendance: 0,
      billsIntroduced: input.sponsoredBills.length,
      billsPassed: input.sponsoredBills.filter((bill) => bill.status === "Passed Chamber" || bill.status === "Signed").length,
      amendmentsOffered: 0,
    },
    ideology: {},
  } satisfies Politician;
}

function normalizePoliticiansFromBills(bills: Bill[]) {
  const bySponsor = new Map<string, Bill[]>();

  for (const bill of bills) {
    const key = bill.sponsorId || bill.sponsorName;
    const existing = bySponsor.get(key) || [];
    existing.push(bill);
    bySponsor.set(key, existing);
  }

  return [...bySponsor.entries()]
    .map(([id, sponsoredBills]) => {
      const firstBill = sponsoredBills[0];

      return buildPoliticianProfile({
        id,
        name: firstBill.sponsorName,
        title:
          firstBill.chamber === "House"
            ? "United States Representative"
            : "United States Senator",
        party: "Unknown",
        state: "Federal",
        sponsoredBills,
      });
    })
    .sort((left, right) => right.stats.billsIntroduced - left.stats.billsIntroduced);
}

async function normalizeCongressMembers(bills: Bill[]) {
  const members = await fetchCongressMembers({ limit: 250 });

  return members.map((member) => {
    const name = member.invertedOrderName
      ? member.invertedOrderName.split(",").reverse().join(" ").trim()
      : [member.honorificName, member.firstName, member.lastName].filter(Boolean).join(" ").trim();
    const slug = slugifySegment(name);
    const currentTerm = member.terms?.item?.[0];
    const sponsoredBills = bills.filter((bill) =>
      bill.sponsorId === member.bioguideId || slugifySegment(bill.sponsorName) === slug,
    );

    return buildPoliticianProfile({
      id: member.bioguideId || slug,
      name,
      title:
        currentTerm?.chamber === "House of Representatives"
          ? "United States Representative"
          : "United States Senator",
      party: member.partyName || "Unknown",
      state: member.state || "Federal",
      district:
        currentTerm?.district && Number(currentTerm.district) > 0
          ? `${member.state}-${currentTerm.district}`
          : undefined,
      sponsoredBills,
    });
  });
}

export async function getPoliticiansData() {
  const billsData = await getBillsData();

  if (isCongressBillsConfigured()) {
    try {
      const politicians = await normalizeCongressMembers(billsData.bills);
      if (politicians.length > 0) {
        return {
          source: "live-congress-members" as PoliticianDataSource,
          politicians,
        };
      }
    } catch {
      if (isLiveBillsSource(billsData.source)) {
        return {
          source: "live-bill-derived" as PoliticianDataSource,
          politicians: normalizePoliticiansFromBills(billsData.bills),
        };
      }

      return {
        source: billsData.source === "unconfigured"
          ? ("unconfigured" as PoliticianDataSource)
          : ("unavailable" as PoliticianDataSource),
        politicians: [] as Politician[],
      };
    }
  }

  if (isLiveBillsSource(billsData.source)) {
    return {
      source: "live-bill-derived" as PoliticianDataSource,
      politicians: normalizePoliticiansFromBills(billsData.bills),
    };
  }

  return {
    source: billsData.source === "unconfigured"
      ? ("unconfigured" as PoliticianDataSource)
      : ("unavailable" as PoliticianDataSource),
    politicians: [] as Politician[],
  };
}

export async function getPoliticianData(slug: string) {
  const { politicians, source } = await getPoliticiansData();
  const politician = politicians.find((item) => item.slug === slug);

  if (!politician) {
    return { source, politician };
  }

  if (isCongressBillsConfigured() && politician.id && politician.id.length <= 8) {
    try {
      const detail = await fetchCongressMemberDetail(politician.id);
      return {
        source,
        politician: {
          ...politician,
          officeAddress:
            detail.member?.addressInformation?.officeAddress
            || politician.officeAddress,
          officePhone:
            detail.member?.addressInformation?.phoneNumber
            || politician.officePhone,
          stats: {
            ...politician.stats,
            billsIntroduced:
              detail.member?.sponsoredLegislation?.count
              ?? politician.stats.billsIntroduced,
          },
        },
      };
    } catch {
      return { source, politician };
    }
  }

  return { source, politician };
}

export async function getPoliticianRouteParams() {
  const { politicians } = await getPoliticiansData();
  return politicians.map((politician) => ({ slug: politician.slug }));
}

export async function getSponsoredBillsForPolitician(slug: string) {
  const { bills } = await getBillsData();
  const { politician } = await getPoliticianData(slug);

  if (!politician) return [];

  return bills.filter((bill) =>
    bill.sponsorId === politician.id || slugifySegment(bill.sponsorName) === politician.slug,
  );
}

export function getPoliticianSourceLabel(source: PoliticianDataSource) {
  if (source === "live-congress-members") return "Live Congress members";
  if (source === "live-bill-derived") return "Live bill-derived sponsors";
  if (source === "unconfigured") return "Congress.gov API not configured";
  return "Politician data unavailable";
}

export function isLivePoliticianSource(source: PoliticianDataSource) {
  return source === "live-congress-members" || source === "live-bill-derived";
}

export function getPoliticianAnalyticsSeries(
  politician: Politician,
  sponsoredBills: Bill[],
) {
  const sponsorshipBase = Math.max(sponsoredBills.length, 1);

  return {
    alignmentSeries: [
      { label: "2020", value: Math.max(politician.stats.votesWithParty - 4, 0) },
      { label: "2021", value: Math.max(politician.stats.votesWithParty - 2, 0) },
      { label: "2022", value: politician.stats.votesWithParty },
      { label: "2023", value: Math.min(politician.stats.votesWithParty + 1, 100) },
      { label: "2024", value: Math.min(politician.stats.votesWithParty + 2, 100) },
    ],
    distribution: [
      { label: "With party", value: politician.stats.votesWithParty || 0 },
      {
        label: "Cross-party",
        value: politician.stats.votesAgainstParty || 0,
      },
    ],
    bipartisanIndex: Math.min(
      100,
      25 + sponsorshipBase * 6 + Math.floor((politician.stats.votesAgainstParty || 0) / 2),
    ),
    missedVotes: Math.max(0, 100 - politician.stats.attendance) * 8,
    leadershipVotes: sponsoredBills.length * 14,
    swingVotes: sponsoredBills.length * 9,
    consecutiveVotes: Math.max(100, politician.stats.attendance * 11),
  };
}
