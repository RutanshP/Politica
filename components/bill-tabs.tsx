import { Tabs } from "@/components/tabs";

type BillTab = "overview" | "timeline" | "text" | "votes";

/**
 * The four real, navigable bill pages. Kept as one component so every bill sub-page shows the
 * same tab set -- previously the overview added Sponsors/Amendments/Related/News tabs that were
 * only anchor scrolls to overview content, so they vanished when you switched tabs.
 */
export function BillTabs({ billId, active }: { billId: string; active: BillTab }) {
  return (
    <Tabs
      items={[
        { label: "Overview", href: `/bills/${billId}`, active: active === "overview" },
        { label: "Timeline", href: `/bills/${billId}/timeline`, active: active === "timeline" },
        { label: "Text", href: `/bills/${billId}/text`, active: active === "text" },
        { label: "Votes", href: `/bills/${billId}/votes`, active: active === "votes" },
      ]}
    />
  );
}
