import {
  fetchCongressCommitteeDetail,
  fetchCongressCommittees,
  getDefaultCongress,
  isCongressBillsConfigured,
} from "@/lib/adapters/congress";
import { getBillsData } from "@/lib/data/bills";
import { slugifySegment } from "@/lib/utils";
import type { Committee } from "@/types/civic";

export type CommitteeDataSource = "live-congress" | "unconfigured" | "unavailable";

export async function getCommitteesData() {
  if (!isCongressBillsConfigured()) {
    return {
      source: "unconfigured" as CommitteeDataSource,
      committees: [] as Committee[],
    };
  }

  try {
    const { bills } = await getBillsData();
    const [senate, house] = await Promise.all([
      fetchCongressCommittees({ congress: getDefaultCongress(), chamber: "senate", limit: 100 }),
      fetchCongressCommittees({ congress: getDefaultCongress(), chamber: "house", limit: 100 }),
    ]);

    const committees: Committee[] = [...senate, ...house].map((committee) => ({
      id: committee.systemCode || slugifySegment(committee.name || "committee"),
      slug: slugifySegment(committee.name || "committee"),
      name: committee.name || "Congressional Committee",
      chamber: committee.chamber || "Congress",
      jurisdiction: "Live committee metadata loaded from Congress.gov.",
      chair: "Chair data not connected",
      rankingMember: "Ranking member data not connected",
      description: "Live committee record imported from Congress.gov.",
      hearing: "Hearing calendar not connected",
      activeBillIds: bills
        .filter((bill) => slugifySegment(bill.committeeName) === slugifySegment(committee.name || "committee"))
        .map((bill) => bill.id),
      memberIds: [],
    }));

    return {
      source: "live-congress" as CommitteeDataSource,
      committees,
    };
  } catch {
    return {
      source: "unavailable" as CommitteeDataSource,
      committees: [] as Committee[],
    };
  }
}

export async function getCommitteeData(slug: string) {
  const { committees, source } = await getCommitteesData();
  const committee = committees.find((item) => item.slug === slug);

  if (!committee || source !== "live-congress" || !committee.id) {
    return { source, committee };
  }

  try {
    const detail = await fetchCongressCommitteeDetail({
      congress: getDefaultCongress(),
      chamber: committee.chamber,
      systemCode: committee.id,
    });

    const { bills } = await getBillsData();

    return {
      source,
      committee: {
        ...committee,
        jurisdiction: detail.committee?.jurisdiction || committee.jurisdiction,
        description:
          detail.committee?.history?.[0]?.officialName
          || committee.description,
        activeBillIds: bills
          .filter((bill) => slugifySegment(bill.committeeName) === committee.slug)
          .map((bill) => bill.id),
      },
    };
  } catch {
    return { source, committee };
  }
}

export async function getCommitteeRouteParams() {
  const { committees } = await getCommitteesData();
  return committees.map((committee) => ({ slug: committee.slug }));
}

export function getCommitteeSourceLabel(source: CommitteeDataSource) {
  if (source === "live-congress") return "Live Congress committees";
  if (source === "unconfigured") return "Congress.gov API not configured";
  return "Committee data unavailable";
}

export function isLiveCommitteeSource(source: CommitteeDataSource) {
  return source === "live-congress";
}
