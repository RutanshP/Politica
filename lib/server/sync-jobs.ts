import { syncFinanceFromFec } from "@/lib/server/finance-sync";
import { syncLegislationFromCongress } from "@/lib/server/legislation-sync";
import { syncNewsFromApi } from "@/lib/server/news-sync";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import {
  rebuildAnalyticsFromStoredData,
  rebuildEntitiesFromStoredData,
  rebuildIssuesFromStoredData,
  rebuildSearchIndexFromStoredData,
} from "@/lib/server/rebuilds";
import { syncPoliticiansFromCongress } from "@/lib/server/politician-sync";
import { syncStateLegislationFromOpenStates } from "@/lib/server/state-sync";

export async function syncBillsAndVotesEverySixHours() {
  return runPipeline("federal_legislation_sync", async () => {
    const result = await syncLegislationFromCongress();
    return {
      recordCount: result.billsSynced + result.committeesSynced,
      metadata: result,
    };
  });
}

export async function syncPoliticiansCommitteesAndFinanceDaily() {
  const [politicians, federalLegislation, stateLegislation, finance] = await Promise.all([
    runPipeline("federal_members_sync", async () => {
      const result = await syncPoliticiansFromCongress();
      return { recordCount: result.synced, metadata: result };
    }),
    runPipeline("federal_legislation_sync", async () => {
      const result = await syncLegislationFromCongress();
      return { recordCount: result.billsSynced + result.committeesSynced, metadata: result };
    }),
    runPipeline("state_legislation_sync", async () => {
      const result = await syncStateLegislationFromOpenStates();
      return { recordCount: result.synced, metadata: result };
    }),
    runPipeline("finance_sync", async () => {
      const result = await syncFinanceFromFec();
      return { recordCount: result.synced, metadata: result };
    }),
  ]);

  return {
    politicians,
    federalLegislation,
    stateLegislation,
    finance,
  };
}

export async function rebuildSearchAndAnalyticsWeekly() {
  const [issues, entities, search, analytics, news] = await Promise.all([
    runPipeline("issue_rebuild", async () => {
      const result = await rebuildIssuesFromStoredData();
      return { recordCount: result.rebuilt, metadata: result };
    }),
    runPipeline("entity_rebuild", async () => {
      const result = await rebuildEntitiesFromStoredData();
      return { recordCount: result.rebuilt, metadata: result };
    }),
    runPipeline("search_rebuild", async () => {
      const result = await rebuildSearchIndexFromStoredData();
      return { recordCount: result.rebuilt, metadata: result };
    }),
    runPipeline("analytics_rebuild", async () => {
      const result = await rebuildAnalyticsFromStoredData();
      return { recordCount: result.rebuilt, metadata: result };
    }),
    runPipeline("news_sync", async () => {
      const result = await syncNewsFromApi();
      return { recordCount: result.synced, metadata: result };
    }),
  ]);

  return {
    issues,
    entities,
    search,
    analytics,
    news,
  };
}
