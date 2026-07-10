import {
  fetchCongressBillActions,
  fetchCongressBillDetail,
  fetchCongressBills,
  fetchCongressBillsByUrl,
  fetchCongressBillTextVersions,
  fetchCongressCommitteeDetail,
  fetchCongressCommittees,
  fetchCongressCommitteesByUrl,
  getDefaultCongress,
  isCongressBillsConfigured,
} from "@/lib/adapters/congress";
import {
  mapBillActionToRow,
  mapBillToRow,
  mapBillVersionToRow,
  mapCommitteeToRow,
} from "@/lib/normalizers/legislation";
import {
  mergeCongressBillDetail,
  normalizeCongressBillListItem,
  parseBillId,
} from "@/lib/normalizers/bills";
import {
  replaceStoredBillActions,
  replaceStoredBillVersions,
  upsertStoredBills,
} from "@/lib/supabase/bills";
import { upsertStoredCommittees } from "@/lib/supabase/committees";
import { slugifySegment } from "@/lib/utils";
import type { Bill, Committee } from "@/types/civic";
import type { CongressCommitteeListItem } from "@/types/congress";

function buildPlaceholderCommittee(bill: Bill) {
  return {
    committeeId: bill.committeeId,
    committeeName: bill.committeeName,
  };
}

async function fetchAllCongressBills() {
  const bills = [];
  const pageSize = 250;
  let offset = 0;

  while (true) {
    const page = await fetchCongressBills({
      congress: getDefaultCongress(),
      limit: pageSize,
      offset,
    });
    bills.push(...page);

    if (page.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return bills;
}

async function fetchAllCommitteeBills(url: string) {
  const bills = [];
  const pageSize = 250;
  let offset = 0;

  while (true) {
    const page = await fetchCongressBillsByUrl(url, {
      limit: pageSize,
      offset,
    });
    bills.push(...page);

    if (page.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return bills;
}

function normalizeCommitteeRecord(
  committee: CongressCommitteeListItem,
  detail: Awaited<ReturnType<typeof fetchCongressCommitteeDetail>> | undefined,
  activeBillIds: string[],
): Committee {
  const name = detail?.committee?.history?.[0]?.officialName || committee.name || "Congressional Committee";
  const chamber = committee.chamber || detail?.committee?.chamber || "Congress";

  return {
    id: committee.systemCode || slugifySegment(name),
    slug: slugifySegment(name),
    name,
    chamber,
    jurisdiction: detail?.committee?.jurisdiction || "Congressional jurisdiction details not provided by the source.",
    chair: "Chair roster not connected from Congress.gov yet",
    rankingMember: "Ranking member roster not connected from Congress.gov yet",
    description: `Synced from Congress.gov committee records for the ${chamber}.`,
    hearing: "Hearing calendar sync not connected yet",
    activeBillIds,
    memberIds: [],
  };
}

export async function syncLegislationFromCongress() {
  if (!isCongressBillsConfigured()) {
    throw new Error("Congress API is not configured");
  }

  const congress = getDefaultCongress();
  const listBills = await fetchAllCongressBills();

  const billResults = await Promise.all(
    listBills.map(async (listBill) => {
      const seed = normalizeCongressBillListItem(listBill);
      const parsed = parseBillId(seed.id);

      if (!parsed) {
        return {
          bill: seed,
          rawBill: listBill,
        };
      }

      try {
        const [detail, actions, textVersions] = await Promise.all([
          fetchCongressBillDetail({
            congress,
            billType: parsed.billType,
            billNumber: parsed.billNumber,
          }),
          fetchCongressBillActions({
            congress,
            billType: parsed.billType,
            billNumber: parsed.billNumber,
          }).catch(() => undefined),
          fetchCongressBillTextVersions({
            congress,
            billType: parsed.billType,
            billNumber: parsed.billNumber,
          }).catch(() => undefined),
        ]);
        const committeeList = detail.bill?.committees?.url
          ? await fetchCongressCommitteesByUrl(detail.bill.committees.url, { limit: 50 }).catch(() => [])
          : [];

        const merged = mergeCongressBillDetail(seed, detail, actions, textVersions);
        const linkedCommittee = committeeList[0];
        const committeeData = linkedCommittee
          ? {
              committeeId: linkedCommittee.systemCode || slugifySegment(linkedCommittee.name || "committee"),
              committeeName: linkedCommittee.name || "Congressional Committee",
            }
          : buildPlaceholderCommittee(merged);

        return {
          bill: {
            ...merged,
            ...committeeData,
          },
          rawBill: detail.bill || listBill,
        };
      } catch {
        return {
          bill: seed,
          rawBill: listBill,
        };
      }
    }),
  );

  const committeeLists = await Promise.all([
    fetchCongressCommittees({ congress, chamber: "senate", limit: 250 }),
    fetchCongressCommittees({ congress, chamber: "house", limit: 250 }),
    fetchCongressCommittees({ congress, chamber: "joint", limit: 250 }).catch(() => []),
  ]);

  const committees = await Promise.all(
    committeeLists.flat().map(async (committee) => {
      try {
        const detail = await fetchCongressCommitteeDetail({
          congress,
          chamber: committee.chamber || "house",
          systemCode: committee.systemCode || slugifySegment(committee.name || "committee"),
        });
        const activeBillIds = detail.committee?.bills?.url
          ? (await fetchAllCommitteeBills(detail.committee.bills.url))
            .map(normalizeCongressBillListItem)
            .map((bill) => bill.id)
          : [];

        return {
          committee: normalizeCommitteeRecord(committee, detail, activeBillIds),
          rawCommittee: detail.committee || committee,
        };
      } catch {
        return {
          committee: normalizeCommitteeRecord(committee, undefined, []),
          rawCommittee: committee,
        };
      }
    }),
  );

  const committeeByBillId = new Map<string, Committee>();
  for (const entry of committees) {
    for (const billId of entry.committee.activeBillIds) {
      if (!committeeByBillId.has(billId)) {
        committeeByBillId.set(billId, entry.committee);
      }
    }
  }

  const finalBills = billResults.map(({ bill, rawBill }) => {
    const committee = committeeByBillId.get(bill.id);

    return {
      bill: committee
        ? {
            ...bill,
            committeeId: committee.id,
            committeeName: committee.name,
          }
        : bill,
      rawBill,
    };
  });

  const relatedByTopic = new Map<string, Bill[]>();
  for (const { bill } of finalBills) {
    const items = relatedByTopic.get(bill.topic) || [];
    items.push(bill);
    relatedByTopic.set(bill.topic, items);
  }

  const finalizedBills = finalBills.map(({ bill, rawBill }) => {
    const relatedBillIds = (relatedByTopic.get(bill.topic) || [])
      .filter((candidate) => candidate.id !== bill.id)
      .slice(0, 3)
      .map((candidate) => candidate.id);

    return {
      bill: {
        ...bill,
        relatedBillIds,
      },
      rawBill,
    };
  });

  const billRows = finalizedBills.map(({ bill, rawBill }) => mapBillToRow(bill, rawBill));
  const actionRows = finalizedBills.flatMap(({ bill }) =>
    bill.actions.map((action, index) => mapBillActionToRow(bill.id, action, index)),
  );
  const versionRows = finalizedBills.flatMap(({ bill }) =>
    bill.versions.map((version, index) => mapBillVersionToRow(bill.id, version, index)),
  );
  const committeeRows = committees.map(({ committee, rawCommittee }) => mapCommitteeToRow(committee, rawCommittee));

  await upsertStoredBills(billRows);
  await replaceStoredBillActions(
    finalizedBills.map(({ bill }) => bill.id),
    actionRows,
  );
  await replaceStoredBillVersions(
    finalizedBills.map(({ bill }) => bill.id),
    versionRows,
  );
  await upsertStoredCommittees(committeeRows);

  return {
    billsSynced: billRows.length,
    committeesSynced: committeeRows.length,
    at: new Date().toISOString(),
  };
}
