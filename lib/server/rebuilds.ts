import { randomUUID } from "node:crypto";

import { getAnalyticsData as getDerivedAnalyticsData } from "@/lib/data/analytics";
import { slugifySegment } from "@/lib/utils";
import { listStoredBills } from "@/lib/supabase/bills";
import { listStoredCommittees } from "@/lib/supabase/committees";
import { replaceStoredEntities } from "@/lib/supabase/entities";
import { replaceStoredIssues } from "@/lib/supabase/issues";
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

export async function rebuildIssuesFromStoredData() {
  const bills = await listStoredBills();
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

export async function rebuildSearchIndexFromStoredData() {
  const [bills, politicians, committees, issues, news] = await Promise.all([
    listStoredBills(),
    listStoredPoliticians(),
    listStoredCommittees(),
    listStoredBills().then(() => import("@/lib/supabase/issues")).then((module) => module.listStoredIssues()).catch(() => []),
    listStoredNewsItems().catch(() => []),
  ]);

  const docs: SearchDocumentRow[] = [
    ...bills.map((bill) => ({
      id: `bill-${bill.id}`,
      entity_id: bill.id,
      entity_type: "bill",
      label: bill.number,
      title: bill.title,
      description: bill.summary,
      href: `/bills/${bill.id}`,
      meta: `${bill.status} | ${bill.chamber} | ${bill.topic}`,
      source_system: "rebuild",
      source_id: bill.id,
      synced_at: new Date().toISOString(),
      raw_payload: bill,
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
      synced_at: new Date().toISOString(),
      raw_payload: politician,
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
      synced_at: new Date().toISOString(),
      raw_payload: committee,
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
      synced_at: new Date().toISOString(),
      raw_payload: issue,
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
      synced_at: new Date().toISOString(),
      raw_payload: item,
    })),
  ];

  await replaceStoredSearchDocuments(docs);

  return {
    rebuilt: docs.length,
    at: new Date().toISOString(),
  };
}

export async function rebuildEntitiesFromStoredData() {
  const [bills, politicians, committees, issues, news] = await Promise.all([
    listStoredBills(),
    listStoredPoliticians(),
    listStoredCommittees(),
    import("@/lib/supabase/issues").then((module) => module.listStoredIssues()).catch(() => []),
    listStoredNewsItems().catch(() => []),
  ]);

  const entityRows: EntityRow[] = [
    ...bills.map((bill) => ({
      id: bill.id,
      entity_type: "bill",
      label: bill.number,
      title: bill.title,
      description: bill.summary,
      href: `/bills/${bill.id}`,
      meta: `${bill.status} | ${bill.topic}`,
      source_system: "rebuild",
      source_id: bill.id,
      synced_at: new Date().toISOString(),
      raw_payload: bill,
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
      synced_at: new Date().toISOString(),
      raw_payload: politician,
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
      synced_at: new Date().toISOString(),
      raw_payload: committee,
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
      synced_at: new Date().toISOString(),
      raw_payload: issue,
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
      synced_at: new Date().toISOString(),
      raw_payload: item,
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
      synced_at: new Date().toISOString(),
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
      synced_at: new Date().toISOString(),
      raw_payload: { newsItemId: item.id, relatedId },
    }))),
  ];

  await replaceStoredEntities(entityRows, relationshipRows);

  return {
    rebuilt: entityRows.length,
    at: new Date().toISOString(),
  };
}

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
