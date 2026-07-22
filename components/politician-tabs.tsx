"use client";

import { Tabs } from "@/components/tabs";

export function PoliticianTabs({
  slug,
  active,
}: {
  slug: string;
  active: "overview" | "bills" | "votes" | "funding" | "analytics";
}) {
  return (
    <Tabs
      items={[
        { label: "Overview", href: `/politicians/${slug}`, active: active === "overview" },
        { label: "Bills", href: `/politicians/${slug}/bills`, active: active === "bills" },
        { label: "Votes", href: `/politicians/${slug}/votes`, active: active === "votes" },
        { label: "Funding", href: `/politicians/${slug}/funding`, active: active === "funding" },
        { label: "Analytics", href: `/politicians/${slug}/analytics`, active: active === "analytics" },
      ]}
    />
  );
}

