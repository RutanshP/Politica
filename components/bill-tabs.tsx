import { Tabs } from "@/components/ui/tabs";
import { billHref } from "@/lib/utils";

type BillTab = "overview" | "timeline" | "version" | "text" | "votes";

/**
 * The real, navigable bill pages. Kept as one component so every bill sub-page shows the same tab
 * set -- previously the overview added Sponsors/Amendments/Related/News tabs that were only anchor
 * scrolls to overview content, so they vanished when you switched tabs. Do not add a tab here that
 * isn't a route.
 *
 * Text and Votes are one tab now. As separate tabs nothing said that a version governs both, or
 * that Overview and Timeline are unaffected by it; folding them under Version Details puts the
 * selector above exactly the content it controls. "text" and "votes" stay in the union because the
 * old routes still exist and redirect.
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
        { label: "Overview", href: billHref(billId), active: active === "overview" },
        {
          label: "Timeline",
          href: billHref(billId, "/timeline"),
          active: active === "timeline",
          count: counts?.timeline,
        },
        {
          label: "Version Details",
          href: billHref(billId, "/version"),
          active: active === "version" || active === "text" || active === "votes",
          count: counts?.text,
        },
      ]}
    />
  );
}
