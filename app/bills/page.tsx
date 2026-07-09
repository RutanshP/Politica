import Link from "next/link";

import { DataTable } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { StatusPill } from "@/components/status-pill";
import { WatchButton } from "@/components/watch-button";
import {
  getBillsData,
  getBillsSourceLabel,
  isLiveBillsSource,
} from "@/lib/data/bills";
import { slugifySegment } from "@/lib/utils";

export const revalidate = 21600;

export default async function BillsPage() {
  const { bills, source } = await getBillsData();
  const live = isLiveBillsSource(source);
  const sessions = [...new Set(bills.map((bill) => bill.session))];
  const topics = [...new Set(bills.map((bill) => bill.topic))];
  const sponsors = [...new Set(bills.map((bill) => bill.sponsorName))];
  const committees = [...new Set(bills.map((bill) => bill.committeeName))];
  const states = [...new Set(bills.map((bill) => bill.state).filter(Boolean))] as string[];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Bills explorer"
        title="Explore live legislation"
        description="Filter legislation across chambers, committees, sponsors, sessions, and issue clusters using the current live feed."
        actions={<SourceBadge label={getBillsSourceLabel(source)} live={live} />}
      />
      <SectionCard title="Filters" description="Prepared for richer federal and state filtering as more live feeds are connected.">
        <FilterBar
          filters={[
            {
              label: "Jurisdiction",
              value: "All",
              options: ["All", "Federal", "State"],
            },
            {
              label: "Country",
              value: "United States",
              options: [...new Set(bills.map((bill) => bill.country))],
            },
            {
              label: "State",
              value: "All states",
              options: ["All states", ...states],
            },
            {
              label: "Chamber",
              value: "Both",
              options: ["Both", ...new Set(bills.map((bill) => bill.chamber))],
            },
            {
              label: "Status",
              value: "All statuses",
              options: ["All statuses", ...new Set(bills.map((bill) => bill.status))],
            },
            {
              label: "Session",
              value: sessions[0] || "Current session",
              options: sessions.length > 0 ? sessions : ["Current session"],
            },
            {
              label: "Topic",
              value: "All topics",
              options: ["All topics", ...topics],
            },
            {
              label: "Sponsor",
              value: "Any sponsor",
              options: ["Any sponsor", ...sponsors],
            },
            {
              label: "Committee",
              value: "Any committee",
              options: ["Any committee", ...committees],
            },
            {
              label: "Introduced",
              value: "Current feed",
              options: ["Current feed"],
            },
            {
              label: "Last action",
              value: "Current feed",
              options: ["Current feed"],
            },
          ]}
        />
      </SectionCard>
      <SectionCard title="Bills table" description="Every row links deeper into the bill, votes, text, committee, and sponsor graph.">
        <DataTable
          columns={[
            "Bill number",
            "Title",
            "Jurisdiction",
            "Chamber",
            "Status",
            "Last action",
            "Sponsor",
            "Committee",
            "Watch",
          ]}
          rows={bills.map((bill) => [
            <Link key={`${bill.id}-number`} href={`/bills/${bill.id}`} className="font-semibold text-[var(--accent)]">
              {bill.number}
            </Link>,
            <div key={`${bill.id}-title`}>
              <p className="font-semibold">{bill.title}</p>
              <p className="mt-1 text-[var(--muted)]">{bill.topic}</p>
            </div>,
            bill.jurisdiction,
            bill.chamber,
            <StatusPill key={`${bill.id}-status`} status={bill.status} />,
            <div key={`${bill.id}-action`}>
              <p>{bill.latestAction}</p>
              <p className="mt-1 text-[var(--muted)]">{bill.lastActionAt}</p>
            </div>,
            <Link key={`${bill.id}-sponsor`} href={`/politicians/${slugifySegment(bill.sponsorName)}`} className="text-[var(--accent)]">
              {bill.sponsorName}
            </Link>,
            <Link key={`${bill.id}-committee`} href={`/committees/${slugifySegment(bill.committeeName)}`} className="text-[var(--accent)]">
              {bill.committeeName}
            </Link>,
            <WatchButton key={`${bill.id}-watch`} />,
          ])}
        />
      </SectionCard>
    </div>
  );
}
