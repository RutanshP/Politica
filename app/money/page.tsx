import Link from "next/link";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { StatCard } from "@/components/stat-card";
import { formatMoney } from "@/components/funding/funding-graph-theme";
import { getMoneyDashboard, type MoneyRankRow } from "@/lib/data/money";

export const revalidate = 21600;

function NameCell({ row }: { row: MoneyRankRow }) {
  return row.href ? (
    <Link href={row.href} className="font-medium text-[var(--ink)] hover:text-[var(--accent)]">
      {row.label}
    </Link>
  ) : (
    <span className="font-medium text-[var(--ink)]">{row.label}</span>
  );
}

function RankTable({
  rows,
  columns,
  cells,
  empty,
}: {
  rows: MoneyRankRow[];
  columns: Parameters<typeof DataTable>[0]["columns"];
  cells: (row: MoneyRankRow) => React.ReactNode[];
  empty: string;
}) {
  return rows.length > 0 ? (
    <DataTable columns={columns} rows={rows.map((row) => [<NameCell key={row.id} row={row} />, ...cells(row)])} />
  ) : (
    <EmptyState title="Nothing stored yet" description={empty} />
  );
}

const plural = (count: number, noun: string) => `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;

export default async function MoneyDashboardPage() {
  const money = await getMoneyDashboard();
  const cycleLabel = money.cycle ? `${money.cycle - 1}–${String(money.cycle).slice(2)} cycle` : "current cycle";
  const live = money.configured && money.totals.membersWithFilings > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Money"
        title="Funding dashboard"
        description={`Campaign fundraising, donor employers, outside spending and lobbying for sitting members of Congress, ${cycleLabel}.`}
        actions={<SourceBadge label={live ? "FEC and LDA filings" : "Funding data not synced yet"} live={live} />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Raised by members"
          value={formatMoney(money.totals.raisedByMembers) || "$0"}
          detail={`Total receipts across ${plural(money.totals.membersWithFilings, "member")} with FEC filings.`}
        />
        <StatCard
          label="Outside spending"
          value={formatMoney(money.totals.outsideSpending) || "$0"}
          detail="Independent expenditures for or against sitting members."
        />
        <StatCard
          label="Lobbying by donor organizations"
          value={formatMoney(money.totals.lobbying) || "$0"}
          detail="LDA-reported spend by organizations whose employees also give to members."
        />
        <StatCard
          label="Members with filings"
          value={money.totals.membersWithFilings.toLocaleString()}
          detail="Sitting members matched to an FEC candidate record this cycle."
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Top fundraisers">
          <RankTable
            rows={money.topFundraisers}
            columns={["Member", { label: "Raised", align: "right" }]}
            cells={(row) => [formatMoney(row.amount)]}
            empty="Run the FEC funding sync to populate campaign totals."
          />
        </SectionCard>
        <SectionCard title="Top donor employers">
          <RankTable
            rows={money.topEmployers}
            columns={["Employer", { label: "Members", align: "right" }, { label: "Given", align: "right" }]}
            cells={(row) => [row.count.toLocaleString(), formatMoney(row.amount)]}
            empty="Employer breakdowns arrive with the FEC funding sync."
          />
          <p className="mt-3 text-xs text-[var(--faint)]">
            Itemized individual contributions grouped by the employer each donor reported — not money from the company itself.
          </p>
        </SectionCard>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Most outside spending">
          <RankTable
            rows={money.outsideSpending}
            columns={["Member", { label: "Supporting", align: "right" }, { label: "Opposing", align: "right" }]}
            cells={(row) => {
              const spend = row as (typeof money.outsideSpending)[number];
              return [formatMoney(spend.support) || "—", formatMoney(spend.oppose) || "—"];
            }}
            empty="No independent expenditures are stored for this cycle."
          />
        </SectionCard>
        <SectionCard title="Lobbying">
          <div className="space-y-5">
            <RankTable
              rows={money.lobbyingClients}
              columns={["Client", { label: "Firms", align: "right" }, { label: "Spent", align: "right" }]}
              cells={(row) => [row.count.toLocaleString(), formatMoney(row.amount)]}
              empty="Run the lobbying sync to populate LDA filings."
            />
            <RankTable
              rows={money.lobbyingFirms}
              columns={["Firm", { label: "Clients", align: "right" }, { label: "Paid", align: "right" }]}
              cells={(row) => [row.count.toLocaleString(), formatMoney(row.amount)]}
              empty="No lobbying firms are connected yet."
            />
          </div>
          <p className="mt-3 text-xs text-[var(--faint)]">
            Only organizations that also appear as donor employers are included, so this is a subset of all federal lobbying.
          </p>
        </SectionCard>
      </section>

      <SectionCard title="Explore the network">
        <div className="flex flex-col gap-3 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--muted)]">
            Follow any member, employer or firm through the funding graph.
          </p>
          <Link href="/money/graph" className="shrink-0 rounded-full bg-[var(--accent)] px-4 py-2 text-center text-sm font-semibold text-white">
            Open graph
          </Link>
        </div>
      </SectionCard>
    </div>
  );
}
