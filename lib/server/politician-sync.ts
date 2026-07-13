import { fetchCongressMemberDetail, fetchCongressMembers, isCongressBillsConfigured } from "@/lib/adapters/congress";
import {
  mapPoliticianToRow,
  normalizeCongressMemberToPolitician,
} from "@/lib/normalizers/politicians";
import { fetchSupabaseRows } from "@/lib/supabase/rest";
import { buildSourceFingerprint, classifyFreshness, normalizeSourceUpdatedAt } from "@/lib/server/sync-freshness";
import { mergeStoredPoliticianStats } from "@/lib/server/politician-stat-deltas";
import { upsertStoredPoliticians } from "@/lib/supabase/politicians";
import type { PoliticianRow } from "@/types/supabase";

const POLITICIAN_PAGE_SIZE = Number.parseInt(
  process.env.POLITICA_POLITICIAN_PAGE_SIZE?.trim() || "250",
  10,
);
const POLITICIAN_DETAIL_CONCURRENCY = Number.parseInt(
  process.env.POLITICA_POLITICIAN_DETAIL_CONCURRENCY?.trim() || "8",
  10,
);

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
) {
  if (items.length === 0) {
    return [] as TOutput[];
  }

  const results = new Array<TOutput>(items.length);
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

function buildMemberLabel(input: {
  id: string;
  name: string;
  state?: string | null;
  district?: string | number | null;
  title?: string | null;
}) {
  return {
    id: input.id,
    name: input.name,
    state: input.state || null,
    district: input.district == null || input.district === "" ? null : String(input.district),
    title: input.title || null,
  };
}

function buildMemberFreshness(member: Awaited<ReturnType<typeof fetchCongressMembers>>[number], detail?: Awaited<ReturnType<typeof fetchCongressMemberDetail>>) {
  const sourceUpdatedAt = normalizeSourceUpdatedAt(detail?.member?.updateDate || member.updateDate);
  const sourceFingerprint = buildSourceFingerprint({
    bioguideId: member.bioguideId,
    updateDate: detail?.member?.updateDate || member.updateDate || null,
    firstName: detail?.member?.firstName || member.firstName || null,
    lastName: detail?.member?.lastName || member.lastName || null,
    state: detail?.member?.state || member.state || null,
    district: detail?.member?.district ?? member.district ?? null,
    terms: detail?.member?.terms || member.terms || null,
    partyName: detail?.member?.partyName || member.partyName || null,
    officeAddress: detail?.member?.addressInformation?.officeAddress || null,
    phoneNumber: detail?.member?.addressInformation?.phoneNumber || null,
    website: detail?.member?.officialWebsiteUrl || null,
    sponsoredCount: detail?.member?.sponsoredLegislation?.count ?? null,
  });

  return { sourceUpdatedAt, sourceFingerprint };
}

export async function syncPoliticiansFromCongress(options?: {
  mode?: "incremental" | "full";
  listOffset?: number;
  listLimit?: number;
}) {
  if (!isCongressBillsConfigured()) {
    throw new Error("Congress API is not configured");
  }

  const mode = options?.mode || "incremental";
  const existingPoliticianSelect = [
    "id",
    "slug",
    "name",
    "party",
    "state",
    "district",
    "stats",
    "source_updated_at",
    "source_fingerprint",
    "last_stats_recomputed_at",
  ].join(",");
  const members = [];
  const pageSize = Number.isFinite(POLITICIAN_PAGE_SIZE) && POLITICIAN_PAGE_SIZE > 0
    ? POLITICIAN_PAGE_SIZE
    : 250;
  const requestedOffset = Number.isFinite(options?.listOffset) && (options?.listOffset ?? 0) > 0
    ? options?.listOffset as number
    : 0;
  const requestedLimit = Number.isFinite(options?.listLimit) && (options?.listLimit ?? 0) > 0
    ? options?.listLimit as number
    : undefined;
  const maxMembers = requestedLimit ?? Number.POSITIVE_INFINITY;
  let offset = requestedOffset;

  while (members.length < maxMembers) {
    const currentLimit = Math.min(pageSize, maxMembers - members.length);
    const page = await fetchCongressMembers({ limit: currentLimit, offset });
    members.push(...page);

    if (page.length < currentLimit) {
      break;
    }

    offset += currentLimit;
  }
  const existingRows = await fetchSupabaseRows<PoliticianRow>(
    "politicians",
    "jurisdiction_type=eq.federal&order=id.asc",
    { cache: "no-store", paginateAll: true, select: existingPoliticianSelect },
  ).catch(() => []);
  const existingById = new Map(existingRows.map((row) => [row.id, row]));

  let newPoliticians = 0;
  let changedPoliticians = 0;
  let unchangedPoliticiansSkipped = 0;
  const updatedMembers: Array<{
    id: string;
    name: string;
    state: string | null;
    district: string | null;
    title: string | null;
    changeType: "new" | "changed";
  }> = [];
  const skippedMembers: Array<{
    id: string;
    name: string;
    state: string | null;
    district: string | null;
    title: string | null;
    changeType: "unchanged";
  }> = [];

  const syncResults = await mapWithConcurrency(
    members,
    Number.isFinite(POLITICIAN_DETAIL_CONCURRENCY) && POLITICIAN_DETAIL_CONCURRENCY > 0
      ? POLITICIAN_DETAIL_CONCURRENCY
      : 8,
    async (member) => {
      const stored = member.bioguideId ? existingById.get(member.bioguideId) : undefined;
      const seedFreshness = buildMemberFreshness(member);
      const seedClassification = mode === "full"
        ? (stored ? "changed" : "new")
        : classifyFreshness(stored, seedFreshness.sourceUpdatedAt, seedFreshness.sourceFingerprint);

      if (seedClassification === "unchanged" && stored) {
        unchangedPoliticiansSkipped += 1;
        skippedMembers.push({
          ...buildMemberLabel({
            id: stored.id,
            name: stored.name,
            state: stored.state,
            district: stored.district,
            title: stored.title,
          }),
          changeType: "unchanged",
        });
        return undefined;
      }

      let detail;

      if (member.bioguideId) {
        try {
          detail = await fetchCongressMemberDetail(member.bioguideId);
        } catch {
          detail = undefined;
        }
      }

      const freshness = buildMemberFreshness(member, detail);
      const classification = mode === "full"
        ? (stored ? "changed" : "new")
        : classifyFreshness(stored, freshness.sourceUpdatedAt, freshness.sourceFingerprint);

      if (classification === "unchanged" && stored) {
        unchangedPoliticiansSkipped += 1;
        skippedMembers.push({
          ...buildMemberLabel({
            id: stored.id,
            name: stored.name,
            state: stored.state,
            district: stored.district,
            title: stored.title,
          }),
          changeType: "unchanged",
        });
        return undefined;
      }

      if (classification === "new") {
        newPoliticians += 1;
      } else {
        changedPoliticians += 1;
      }

      const politician = normalizeCongressMemberToPolitician(member, detail);
      const mapped = mapPoliticianToRow(politician, detail?.member || member);
      const withFreshness: PoliticianRow = {
        ...mapped,
        stats: mergeStoredPoliticianStats(mapped.stats, stored?.stats),
        source_updated_at: freshness.sourceUpdatedAt,
        source_fingerprint: freshness.sourceFingerprint,
        last_profile_synced_at: new Date().toISOString(),
        last_stats_recomputed_at: stored?.last_stats_recomputed_at || null,
      };
      updatedMembers.push({
        ...buildMemberLabel({
          id: withFreshness.id,
          name: withFreshness.name,
          state: withFreshness.state,
          district: withFreshness.district,
          title: withFreshness.title,
        }),
        changeType: classification === "new" ? "new" : "changed",
      });
      return withFreshness;
    },
  );
  const rows = syncResults.filter((row) => Boolean(row)) as PoliticianRow[];

  const uniqueRows = rows.reduce<PoliticianRow[]>((collection, row) => {
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

  if (uniqueRows.length > 0) {
    await upsertStoredPoliticians(uniqueRows);
  }

  return {
    synced: uniqueRows.length,
    newPoliticians,
    changedPoliticians,
    unchangedPoliticiansSkipped,
    updatedMembers,
    skippedMembers,
    scannedMembers: members.length,
    requestedOffset,
    requestedLimit: requestedLimit ?? null,
    mode,
    at: new Date().toISOString(),
  };
}
