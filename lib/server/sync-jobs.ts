import { syncFinanceFromFec } from "@/lib/server/finance-sync";
import { syncLegislationFromCongress } from "@/lib/server/legislation-sync";
import { syncNewsFromApi } from "@/lib/server/news-sync";
import { runPipeline } from "@/lib/server/pipeline-orchestrator";
import {
  loadRebuildInputs,
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
  // Load the shared corpus once, then rebuild sequentially. The old Promise.all had each rebuild
  // re-fetch the corpus (heavy Supabase egress) and held several copies in memory at once (OOM).
  const inputs = await loadRebuildInputs();

  const issues = await runPipeline("issue_rebuild", async () => {
    const result = await rebuildIssuesFromStoredData(inputs);
    return { recordCount: result.rebuilt, metadata: result };
  });
  const entities = await runPipeline("entity_rebuild", async () => {
    const result = await rebuildEntitiesFromStoredData(inputs);
    return { recordCount: result.rebuilt, metadata: result };
  });
  const search = await runPipeline("search_rebuild", async () => {
    const result = await rebuildSearchIndexFromStoredData(inputs);
    return { recordCount: result.rebuilt, metadata: result };
  });
  const analytics = await runPipeline("analytics_rebuild", async () => {
    const result = await rebuildAnalyticsFromStoredData();
    return { recordCount: result.rebuilt, metadata: result };
  });
  const news = await runPipeline("news_sync", async () => {
    const result = await syncNewsFromApi();
    return { recordCount: result.synced, metadata: result };
  });

  return {
    issues,
    entities,
    search,
    analytics,
    news,
  };
}
