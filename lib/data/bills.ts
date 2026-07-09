import {
  fetchCongressBillActions,
  fetchCongressBillDetail,
  fetchCongressBills,
  fetchCongressBillTextVersions,
  getDefaultCongress,
  isCongressBillsConfigured,
} from "@/lib/adapters/congress";
import {
  mergeCongressBillDetail,
  normalizeCongressBillListItem,
  parseBillId,
} from "@/lib/normalizers/bills";
import type { CongressBillListItem } from "@/types/congress";
import type { Bill } from "@/types/civic";

export type BillDataSource = "live-congress" | "unconfigured" | "unavailable";

function withRelatedBills(bills: Bill[]) {
  return bills.map((bill) => ({
    ...bill,
    relatedBillIds: bills
      .filter((candidate) =>
        candidate.id !== bill.id
        && (
          candidate.topic === bill.topic
          || candidate.sponsorId === bill.sponsorId
          || candidate.committeeId === bill.committeeId
        ),
      )
      .slice(0, 3)
      .map((candidate) => candidate.id),
  }));
}

export async function getBillsData() {
  if (!isCongressBillsConfigured()) {
    return {
      source: "unconfigured" as BillDataSource,
      bills: [] as Bill[],
    };
  }

  try {
    const liveBills = await fetchCongressBills({
      congress: getDefaultCongress(),
      limit: 24,
    });

    return {
      source: "live-congress" as BillDataSource,
      bills: withRelatedBills(liveBills.map(normalizeCongressBillListItem)),
    };
  } catch {
    return {
      source: "unavailable" as BillDataSource,
      bills: [] as Bill[],
    };
  }
}

export async function getBillData(billId: string) {
  if (!isCongressBillsConfigured()) {
    return {
      source: "unconfigured" as BillDataSource,
      bill: undefined,
    };
  }

  const parsed = parseBillId(billId);
  if (!parsed) {
    return {
      source: "unavailable" as BillDataSource,
      bill: undefined,
    };
  }

  try {
    const list = await fetchCongressBills({
      congress: getDefaultCongress(),
      limit: 250,
    });
    const normalizedBills = withRelatedBills(list.map(normalizeCongressBillListItem));
    const listBill = normalizedBills.find((candidate) => candidate.id === billId);

    const [detail, actions, textVersions] = await Promise.all([
      fetchCongressBillDetail({
        congress: getDefaultCongress(),
        billType: parsed.billType,
        billNumber: parsed.billNumber,
      }),
      fetchCongressBillActions({
        congress: getDefaultCongress(),
        billType: parsed.billType,
        billNumber: parsed.billNumber,
      }).catch(() => undefined),
      fetchCongressBillTextVersions({
        congress: getDefaultCongress(),
        billType: parsed.billType,
        billNumber: parsed.billNumber,
      }).catch(() => undefined),
    ]);

    const seed =
      listBill
      || normalizeCongressBillListItem((detail.bill || {}) as CongressBillListItem);
    const merged = mergeCongressBillDetail(seed, detail, actions, textVersions);
    const relatedBillIds = normalizedBills
      .filter((candidate) =>
        candidate.id !== merged.id
        && (
          candidate.topic === merged.topic
          || candidate.sponsorId === merged.sponsorId
          || candidate.committeeId === merged.committeeId
        ),
      )
      .slice(0, 3)
      .map((candidate) => candidate.id);

    return {
      source: "live-congress" as BillDataSource,
      bill: {
        ...merged,
        relatedBillIds,
      },
    };
  } catch {
    return {
      source: "unavailable" as BillDataSource,
      bill: undefined,
    };
  }
}

export async function getBillRouteParams() {
  const { bills } = await getBillsData();
  return bills.map((bill) => ({ billId: bill.id }));
}

export function isLiveBillsSource(source: BillDataSource) {
  return source === "live-congress";
}

export function getBillsSourceLabel(source: BillDataSource) {
  if (source === "live-congress") return "Live Congress.gov data";
  if (source === "unconfigured") return "Congress.gov API not configured";
  return "Congress.gov data unavailable";
}

export function getRecentlyPassedBills(bills: Bill[]) {
  return bills.filter((bill) => bill.status === "Passed Chamber" || bill.status === "Signed").slice(0, 4);
}
