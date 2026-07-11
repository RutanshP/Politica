import { normalizePersonLookup, slugifySegment } from "@/lib/utils";
import type { Bill, Politician } from "@/types/civic";

export function findPoliticianForBillSponsor(bill: Bill, politicians: Politician[]) {
  const normalizedSponsorName = normalizePersonLookup(bill.sponsorName);

  return politicians.find((politician) =>
    politician.id === bill.sponsorId
    || politician.name === bill.sponsorName
    || normalizePersonLookup(politician.name) === normalizedSponsorName
    || politician.slug === slugifySegment(bill.sponsorName),
  );
}
