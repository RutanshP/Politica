import { VOTE_CATEGORY_META, type VoteCategory } from "@/lib/vote-classification";
import { cn } from "@/lib/utils";

export function VoteTypeBadge({ category }: { category?: VoteCategory }) {
  if (!category) return null;
  const meta = VOTE_CATEGORY_META[category];
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", meta.tone)}>
      {meta.label}
    </span>
  );
}
