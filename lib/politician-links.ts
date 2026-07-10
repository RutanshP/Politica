import { slugifySegment } from "@/lib/utils";
import type { Bill, Politician } from "@/types/civic";

export function findPoliticianForBillSponsor(bill: Bill, politicians: Politician[]) {
  return politicians.find((politician) =>
    politician.id === bill.sponsorId
    || politician.name === bill.sponsorName
    || politician.slug === slugifySegment(bill.sponsorName),
  );
}

