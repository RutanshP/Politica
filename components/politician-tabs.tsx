import { Tabs } from "@/components/ui/tabs";

/** Counts are optional: a tab shows a badge only where the caller actually knows the number. */
export function PoliticianTabs({
  slug,
  active,
  counts,
}: {
  slug: string;
  active: "overview" | "bills" | "votes" | "funding" | "analytics";
  counts?: { bills?: number; votes?: number };
}) {
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
        { label: "Funding", href: `/politicians/${slug}/funding`, active: active === "funding" },
        {
          label: "Analytics",
          href: `/politicians/${slug}/analytics`,
          active: active === "analytics",
        },
      ]}
    />
  );
}
