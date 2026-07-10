import { fetchCongressMemberDetail, fetchCongressMembers, isCongressBillsConfigured } from "@/lib/adapters/congress";
import {
  mapPoliticianToRow,
  normalizeCongressMemberToPolitician,
} from "@/lib/normalizers/politicians";
import { upsertStoredPoliticians } from "@/lib/supabase/politicians";

export async function syncPoliticiansFromCongress() {
  if (!isCongressBillsConfigured()) {
    throw new Error("Congress API is not configured");
  }

  const members = [];
  const pageSize = 250;
  let offset = 0;

  while (true) {
    const page = await fetchCongressMembers({ limit: pageSize, offset });
    members.push(...page);

    if (page.length < pageSize) {
      break;
    }

    offset += pageSize;
  }
  const rows = await Promise.all(
    members.map(async (member) => {
      let detail;

      if (member.bioguideId) {
        try {
          detail = await fetchCongressMemberDetail(member.bioguideId);
        } catch {
          detail = undefined;
        }
      }

      const politician = normalizeCongressMemberToPolitician(member, detail);
      return mapPoliticianToRow(politician, detail?.member || member);
    }),
  );

  const uniqueRows = rows.reduce<typeof rows>((collection, row) => {
    if (collection.some((candidate) => candidate.id === row.id)) {
      return collection;
    }

    const sameSlugCount = collection.filter((candidate) => candidate.slug === row.slug).length;
    if (sameSlugCount > 0) {
      const slugBase = row.slug;
      const withState = row.state ? `${slugBase}-${row.state.toLowerCase()}` : slugBase;
      row.slug = collection.some((candidate) => candidate.slug === withState)
        ? `${withState}-${row.id.toLowerCase()}`
        : withState;
    }

    collection.push(row);
    return collection;
  }, []);

  await upsertStoredPoliticians(uniqueRows);

  return {
    synced: uniqueRows.length,
    at: new Date().toISOString(),
  };
}
