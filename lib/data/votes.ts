import { getBillData, isLiveBillsSource } from "@/lib/data/bills";
import type { Vote } from "@/types/civic";

export type VoteDataSource = "official-vote-feed-pending" | "unconfigured" | "unavailable";

export async function getVotesDataForBill(billId: string) {
  const emptyVotes: Vote[] = [];
  const { bill, source: billSource } = await getBillData(billId);

  if (!bill && billSource === "unconfigured") {
    return {
      source: "unconfigured" as VoteDataSource,
      votes: emptyVotes,
    };
  }

  if (!bill || !isLiveBillsSource(billSource)) {
    return {
      source: "unavailable" as VoteDataSource,
      votes: emptyVotes,
    };
  }

  return {
    source: "official-vote-feed-pending" as VoteDataSource,
    votes: emptyVotes,
  };
}

export function getVoteSourceLabel(source: VoteDataSource) {
  if (source === "official-vote-feed-pending") {
    return "Live bill loaded, vote positions feed not connected";
  }

  return source === "unconfigured"
    ? "Congress.gov API not configured"
    : "Vote data unavailable";
}

export function isLiveVoteSource(source: VoteDataSource) {
  void source;
  return false;
}
