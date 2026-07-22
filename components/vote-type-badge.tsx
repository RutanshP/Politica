import { Badge } from "@/components/ui/badge";
import { VOTE_CATEGORY_META, type VoteCategory } from "@/lib/vote-classification";

export function VoteTypeBadge({ category }: { category?: VoteCategory }) {
  if (!category) return null;
  const meta = VOTE_CATEGORY_META[category];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
