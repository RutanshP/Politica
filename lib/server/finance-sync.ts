import { slugifySegment } from "@/lib/utils";
import { fetchFecCandidateTotals, isFecConfigured, searchFecCandidatesByName } from "@/lib/adapters/fec";
import { listStoredPoliticians } from "@/lib/supabase/politicians";
import { replaceStoredFinanceGraph } from "@/lib/supabase/finance";
import type {
  CandidateFinanceSnapshotRow,
  FinanceEdgeRow,
  FinanceEntityRow,
} from "@/types/supabase";

export async function syncFinanceFromFec() {
  if (!isFecConfigured()) {
    throw new Error("FEC API is not configured");
  }

  const politicians = await listStoredPoliticians({ fresh: true });
  const entityRows: FinanceEntityRow[] = [];
  const edgeRows: FinanceEdgeRow[] = [];
  const snapshotRows: CandidateFinanceSnapshotRow[] = [];

  for (const politician of politicians.slice(0, 25)) {
    try {
      const lookup = await searchFecCandidatesByName(politician.name);
      const candidate = lookup.results?.[0];
      if (!candidate?.candidate_id) {
        continue;
      }

      entityRows.push({
        id: politician.slug,
        slug: politician.slug,
        label: politician.name,
        entity_type: "politician",
        detail: `${politician.party} | ${politician.state}`,
        amount: null,
        href: `/politicians/${politician.slug}`,
        source_system: "fec",
        source_id: candidate.candidate_id,
        synced_at: new Date().toISOString(),
        raw_payload: candidate,
      });

      const totals = await fetchFecCandidateTotals(candidate.candidate_id);
      const committees = totals.results ?? [];

      snapshotRows.push({
        id: `${politician.id}-2024`,
        politician_id: politician.id,
        election_cycle: "2024",
        receipts: Math.round(committees.reduce((sum, item) => sum + (item.receipts || 0), 0)),
        disbursements: Math.round(committees.reduce((sum, item) => sum + (item.disbursements || 0), 0)),
        cash_on_hand: Math.round(committees.reduce((sum, item) => sum + (item.cash_on_hand_end_period || 0), 0)),
        source_system: "fec",
        source_id: candidate.candidate_id,
        synced_at: new Date().toISOString(),
        raw_payload: totals,
      });

      for (const committee of committees.slice(0, 8)) {
        const committeeId = committee.committee_id || slugifySegment(committee.committee_name || "committee");
        entityRows.push({
          id: committeeId,
          slug: committeeId,
          label: committee.committee_name || "Campaign Committee",
          entity_type: "pac",
          detail: committee.receipts
            ? `$${Math.round(committee.receipts).toLocaleString()} in receipts`
            : "Receipts not available",
          amount: committee.receipts ? `$${Math.round(committee.receipts).toLocaleString()}` : null,
          href: null,
          source_system: "fec",
          source_id: committee.committee_id || committeeId,
          synced_at: new Date().toISOString(),
          raw_payload: committee,
        });

        edgeRows.push({
          id: `fec-${committeeId}-${politician.slug}`,
          source: committeeId,
          target: politician.slug,
          label: "funds campaign",
          amount: Math.round(committee.receipts || 0),
          source_system: "fec",
          source_id: committee.committee_id || committeeId,
          synced_at: new Date().toISOString(),
          raw_payload: committee,
        });
      }
    } catch {
      continue;
    }
  }

  await replaceStoredFinanceGraph(entityRows, edgeRows, snapshotRows);

  return {
    synced: entityRows.length + edgeRows.length + snapshotRows.length,
    at: new Date().toISOString(),
  };
}
