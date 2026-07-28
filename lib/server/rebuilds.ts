import { randomUUID } from "node:crypto";

import { getAnalyticsData as getDerivedAnalyticsData } from "@/lib/data/analytics";
import { billHref, slugifySegment } from "@/lib/utils";
import { listStoredBills } from "@/lib/supabase/bills";
import { listStoredCommittees } from "@/lib/supabase/committees";
import { replaceStoredEntities } from "@/lib/supabase/entities";
import { listStoredIssues, replaceStoredIssues } from "@/lib/supabase/issues";
import { listStoredNewsItems } from "@/lib/supabase/news";
import { listStoredPoliticians } from "@/lib/supabase/politicians";
import { replaceStoredSearchDocuments } from "@/lib/supabase/search";
import { replaceAnalyticsSnapshots } from "@/lib/supabase/analytics";
import type {
  AnalyticsSnapshotRow,
  EntityRelationshipRow,
  EntityRow,
  IssueBillLinkRow,
  IssueRow,
  SearchDocumentRow,
} from "@/types/supabase";

/**
 * The stored datasets every rebuild derives from. Loading these once and passing them to each
 * rebuild avoids re-downloading the full bills table (~30 MB) several times per run -- previously
 * `search` alone fetched it twice plus `fresh: true` cache-bypassed politicians/committees, so a
 * single nightly rebuild pulled the corpus 5-6x. That repeated egress was the dominant driver of
 * the Supabase egress overage, and the redundant in-memory copies were what OOM'd the function.
 */
export interface RebuildInputs {
  bills: Awaited<ReturnType<typeof listStoredBills>>;
  politicians: Awaited<ReturnType<typeof listStoredPoliticians>>;
  committees: Awaited<ReturnType<typeof listStoredCommittees>>;
  issues: Awaited<ReturnType<typeof listStoredIssues>>;
  news: Awaited<ReturnType<typeof listStoredNewsItems>>;
}

export async function loadRebuildInputs(): Promise<RebuildInputs> {
  const [bills, politicians, committees, issues, news] = await Promise.all([
    listStoredBills(),
    listStoredPoliticians(),
    listStoredCommittees(),
    listStoredIssues().catch(() => []),
    listStoredNewsItems().catch(() => []),
  ]);
  return { bills, politicians, committees, issues, news };
}

export async function rebuildIssuesFromStoredData(inputs?: RebuildInputs) {
  const bills = inputs?.bills ?? await listStoredBills();
  const byTopic = new Map<string, typeof bills>();

  for (const bill of bills) {
    const items = byTopic.get(bill.topic) || [];
    items.push(bill);
    byTopic.set(bill.topic, items);
  }

  const issueRows: IssueRow[] = [...byTopic.entries()].map(([topic, topicBills]) => ({
    id: slugifySegment(topic),
    slug: slugifySegment(topic),
    name: topic,
    description: `Stored issue cluster derived from synced legislative data tagged to ${topic}.`,
    stats: {
      activeBills: topicBills.length,
      recentVotes: topicBills.reduce((sum, bill) => sum + bill.stats.votes, 0),
      bipartisanSupport:
        Math.round(topicBills.reduce((sum, bill) => sum + bill.stats.bipartisanScore, 0) / Math.max(topicBills.length, 1)),
    },
    top_bill_ids: topicBills.slice(0, 4).map((bill) => bill.id),
    committee_ids: [...new Set(topicBills.map((bill) => bill.committeeId))],
    source_system: "rebuild",
    source_id: slugifySegment(topic),
    synced_at: new Date().toISOString(),
    raw_payload: topicBills.map((bill) => bill.id),
  }));

  const linkRows: IssueBillLinkRow[] = issueRows.flatMap((issue) =>
    issue.top_bill_ids.map((billId, index) => ({
      issue_id: issue.id,
      bill_id: billId,
      sort_order: index,
      source_system: "rebuild",
      source_id: `${issue.id}-${billId}`,
      synced_at: new Date().toISOString(),
      raw_payload: { billId },
    })),
  );

  await replaceStoredIssues(issueRows, linkRows);

  return {
    rebuilt: issueRows.length,
    at: new Date().toISOString(),
  };
}

// A search document carried a full copy of its source record in raw_payload -- the entire bill,
// politician or committee object. Nothing ever read it back: the only consumer is
// `rawAvailable: Boolean(row.raw_payload)`, and the select these rows are read through does not
// even fetch the column. Duplicating the whole corpus into the index was what made the write too
// large to complete, on top of storing a second copy of every bill. Same reasoning as the
// votes.raw_payload reclaim in 018.
const NO_RAW_PAYLOAD = null;

export async function rebuildSearchIndexFromStoredData(inputs?: RebuildInputs) {
  const { bills, politicians, committees, issues, news } = inputs ?? await loadRebuildInputs();

  // One timestamp for the whole run: replaceStoredSearchDocuments prunes the previous index by
  // synced_at, and a uniform stamp makes that cutoff exact.
  const syncedAt = new Date().toISOString();

  const docs: SearchDocumentRow[] = [
    ...bills.map((bill) => ({
      id: `bill-${bill.id}`,
      entity_id: bill.id,
      entity_type: "bill",
      label: bill.number,
      title: bill.title,
      description: bill.summary,
      href: billHref(bill.id),
      meta: `${bill.status} | ${bill.chamber} | ${bill.topic}`,
      source_system: "rebuild",
      source_id: bill.id,
      synced_at: syncedAt,
      raw_payload: NO_RAW_PAYLOAD,
    })),
    ...politicians.map((politician) => ({
      id: `politician-${politician.id}`,
      entity_id: politician.slug,
      entity_type: "politician",
      label: politician.name,
      title: politician.title,
      description: politician.biography,
      href: `/politicians/${politician.slug}`,
      meta: `${politician.party} | ${politician.state}`,
      source_system: "rebuild",
      source_id: politician.id,
      synced_at: syncedAt,
      raw_payload: NO_RAW_PAYLOAD,
    })),
    ...committees.map((committee) => ({
      id: `committee-${committee.id}`,
      entity_id: committee.slug,
      entity_type: "committee",
      label: committee.name,
      title: committee.chamber,
      description: committee.description,
      href: `/committees/${committee.slug}`,
      meta: `${committee.activeBillIds.length} active bills`,
      source_system: "rebuild",
      source_id: committee.id,
      synced_at: syncedAt,
      raw_payload: NO_RAW_PAYLOAD,
    })),
    ...issues.map((issue) => ({
      id: `issue-${issue.id}`,
      entity_id: issue.slug,
      entity_type: "issue",
      label: issue.name,
      title: "Issue area",
      description: issue.description,
      href: `/issues/${issue.slug}`,
      meta: `${issue.stats.activeBills} active bills`,
      source_system: "rebuild",
      source_id: issue.id,
      synced_at: syncedAt,
      raw_payload: NO_RAW_PAYLOAD,
    })),
    ...news.map((item) => ({
      id: `news-${item.id}`,
      entity_id: item.id,
      entity_type: "news",
      label: item.headline,
      title: item.source,
      description: item.summary,
      href: "/news",
      meta: item.publishedAt,
      source_system: "rebuild",
      source_id: item.id,
      synced_at: syncedAt,
      raw_payload: NO_RAW_PAYLOAD,
    })),
  ];

  await replaceStoredSearchDocuments(docs);

  return {
    rebuilt: docs.length,
    at: new Date().toISOString(),
  };
}

export async function rebuildEntitiesFromStoredData(inputs?: RebuildInputs) {
  const { bills, politicians, committees, issues, news } = inputs ?? await loadRebuildInputs();

  const syncedAt = new Date().toISOString();

  const entityRows: EntityRow[] = [
    ...bills.map((bill) => ({
      id: bill.id,
      entity_type: "bill",
      label: bill.number,
      title: bill.title,
      description: bill.summary,
      href: billHref(bill.id),
      meta: `${bill.status} | ${bill.topic}`,
      source_system: "rebuild",
      source_id: bill.id,
      synced_at: syncedAt,
      raw_payload: NO_RAW_PAYLOAD,
    })),
    ...politicians.map((politician) => ({
      id: politician.slug,
      entity_type: "politician",
      label: politician.name,
      title: politician.title,
      description: politician.biography,
      href: `/politicians/${politician.slug}`,
      meta: `${politician.party} | ${politician.state}`,
      source_system: "rebuild",
      source_id: politician.id,
      synced_at: syncedAt,
      raw_payload: NO_RAW_PAYLOAD,
    })),
    ...committees.map((committee) => ({
      id: committee.slug,
      entity_type: "committee",
      label: committee.name,
      title: committee.chamber,
      description: committee.description,
      href: `/committees/${committee.slug}`,
      meta: `${committee.activeBillIds.length} active bills`,
      source_system: "rebuild",
      source_id: committee.id,
      synced_at: syncedAt,
      raw_payload: NO_RAW_PAYLOAD,
    })),
    ...issues.map((issue) => ({
      id: issue.slug,
      entity_type: "issue",
      label: issue.name,
      title: "Issue area",
      description: issue.description,
      href: `/issues/${issue.slug}`,
      meta: `${issue.stats.activeBills} active bills`,
      source_system: "rebuild",
      source_id: issue.id,
      synced_at: syncedAt,
      raw_payload: NO_RAW_PAYLOAD,
    })),
    ...news.map((item) => ({
      id: item.id,
      entity_type: "news",
      label: item.headline,
      title: item.source,
      description: item.summary,
      href: "/news",
      meta: item.publishedAt,
      source_system: "rebuild",
      source_id: item.id,
      synced_at: syncedAt,
      raw_payload: NO_RAW_PAYLOAD,
    })),
  ];

  const relationshipRows: EntityRelationshipRow[] = [
    ...bills.flatMap((bill) => bill.relatedBillIds.map((relatedId) => ({
      id: randomUUID(),
      source_entity_id: bill.id,
      target_entity_id: relatedId,
      relationship_type: "related-bill",
      weight: 1,
      source_system: "rebuild",
      source_id: `${bill.id}-${relatedId}`,
      synced_at: syncedAt,
      raw_payload: { billId: bill.id, relatedId },
    }))),
    ...news.flatMap((item) => item.relatedIds.map((relatedId) => ({
      id: randomUUID(),
      source_entity_id: item.id,
      target_entity_id: relatedId,
      relationship_type: "mentioned-in-news",
      weight: 1,
      source_system: "rebuild",
      source_id: `${item.id}-${relatedId}`,
      synced_at: syncedAt,
      raw_payload: { newsItemId: item.id, relatedId },
    }))),
  ];

  await replaceStoredEntities(entityRows, relationshipRows);

  return {
    rebuilt: entityRows.length,
    at: new Date().toISOString(),
  };
}

// Analytics derives from getDerivedAnalyticsData(), which loads its own datasets, so unlike the
// other rebuilds it takes no shared inputs. (A zero-arg function is still assignable where the
// caller passes the shared inputs -- the extra argument is simply ignored.)
export async function rebuildAnalyticsFromStoredData() {
  const analytics = await getDerivedAnalyticsData();
  const rows: AnalyticsSnapshotRow[] = [{
    id: "dashboard-summary",
    key: "dashboard-summary",
    payload: analytics.summary,
    source_system: "rebuild",
    source_id: "dashboard-summary",
    synced_at: new Date().toISOString(),
    raw_payload: analytics,
  }];

  await replaceAnalyticsSnapshots(rows);
  return {
    rebuilt: rows.length,
    at: new Date().toISOString(),
  };
}
