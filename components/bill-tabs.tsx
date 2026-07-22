import { Tabs } from "@/components/ui/tabs";

type BillTab = "overview" | "timeline" | "text" | "votes";

/**
 * The four real, navigable bill pages. Kept as one component so every bill sub-page shows the
 * same tab set -- previously the overview added Sponsors/Amendments/Related/News tabs that were
 * only anchor scrolls to overview content, so they vanished when you switched tabs. Do not add a
 * tab here that isn't a route.
 *
 * Counts are optional: a tab shows a badge only where the caller actually knows the number.
 */
export function BillTabs({
  billId,
  active,
  counts,
}: {
  billId: string;
  active: BillTab;
  counts?: { timeline?: number; text?: number; votes?: number };
}) {
  return (
    <Tabs
      className="mb-4"
      items={[
        { label: "Overview", href: `/bills/${billId}`, active: active === "overview" },
        {
          label: "Timeline",
          href: `/bills/${billId}/timeline`,
          active: active === "timeline",
          count: counts?.timeline,
        },
        {
          label: "Text",
          href: `/bills/${billId}/text`,
          active: active === "text",
          count: counts?.text,
        },
        {
          label: "Votes",
          href: `/bills/${billId}/votes`,
          active: active === "votes",
          count: counts?.votes,
        },
      ]}
    />
  );
}
