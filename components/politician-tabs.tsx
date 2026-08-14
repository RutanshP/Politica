import { Tabs } from "@/components/ui/tabs";

/**
 * Only members of Congress file periodic transaction reports.
 *
 * The President, Vice President and governors are in this table too, and they disclose under
 * entirely different regimes -- so a Trading tab on their page would promise data that does not
 * exist for them and read as "they made no trades" rather than "this does not apply".
 */
function filesWithCongress(title?: string | null) {
  return /senator|representative|delegate|commissioner/i.test(title || "");
}

/** Counts are optional: a tab shows a badge only where the caller actually knows the number. */
export function PoliticianTabs({
  slug,
  active,
  counts,
  title,
}: {
  slug: string;
  active: "overview" | "bills" | "votes" | "tenure" | "funding" | "trading" | "analytics";
  counts?: { bills?: number; votes?: number };
  /** The member's office. Omit to keep every tab; pass it to hide ones that cannot apply. */
  title?: string | null;
}) {
  const showTrading = title === undefined || filesWithCongress(title);

  return (
    <Tabs
      className="mb-4"
      items={[
        { label: "Overview", href: `/politicians/${slug}`, active: active === "overview" },
        {
          label: "Bills",
          href: `/politicians/${slug}/bills`,
          active: active === "bills",
          count: counts?.bills,
        },
        {
          label: "Votes",
          href: `/politicians/${slug}/votes`,
          active: active === "votes",
          count: counts?.votes,
        },
        { label: "Tenure", href: `/politicians/${slug}/tenure`, active: active === "tenure" },
        { label: "Funding", href: `/politicians/${slug}/funding`, active: active === "funding" },
        ...(showTrading
          ? [{ label: "Trading", href: `/politicians/${slug}/trading`, active: active === "trading" }]
          : []),
        {
          label: "Analytics",
          href: `/politicians/${slug}/analytics`,
          active: active === "analytics",
        },
      ]}
    />
  );
}
