import { Network } from "lucide-react";
import Link from "next/link";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { StatCard } from "@/components/stat-card";
import { formatMoney } from "@/components/funding/funding-graph-theme";
import { LobbiedBillsCard } from "@/components/lobbying/lobbied-bills-card";
import {
  clientHref,
  getLobbyingOverview,
  getMostLobbiedBills,
  getTopLobbyingClients,
  latestLobbyingYear,
} from "@/lib/data/lobbying";
import { getMoneyDashboard, getTopPacs, type MoneyRankRow, type TopPacRow } from "@/lib/data/money";
import { PAC_CATEGORY_LABEL } from "@/lib/graph/pac-classification";

export const revalidate = 21600;

function NetworkLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      title={`${label} in the money network`}
      aria-label={`Show ${label} in the money network`}
      className="inline-grid h-6 w-6 flex-none place-items-center rounded-[var(--r-sm)] text-[var(--faint)] transition hover:bg-[var(--panel-3)] hover:text-[var(--accent-2)]"
    >
      <Network className="h-3.5 w-3.5" />
    </Link>
  );
}

function NameCell({ row }: { row: MoneyRankRow }) {
  return (
    <span className="flex items-center gap-1.5">
      {row.href ? (
        <Link href={row.href} className="font-medium text-[var(--ink)] hover:text-[var(--accent)]">
          {row.label}
        </Link>
      ) : (
        <span className="font-medium text-[var(--ink)]">{row.label}</span>
      )}
      {row.networkHref ? <NetworkLink href={row.networkHref} label={row.label} /> : null}
    </span>
  );
}

function PartySplit({ pac }: { pac: TopPacRow }) {
  const other = Math.max(0, 1 - pac.democraticShare - pac.republicanShare);
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="flex h-1.5 w-20 overflow-hidden rounded-full bg-[var(--panel-3)]" aria-hidden="true">
        <span style={{ width: `${pac.democraticShare * 100}%` }} className="bg-[var(--party-d)]" />
        <span style={{ width: `${other * 100}%` }} className="bg-[var(--party-i)]" />
        <span style={{ width: `${pac.republicanShare * 100}%` }} className="bg-[var(--party-r)]" />
      </span>
      <span className="num w-16 text-right text-xs text-[var(--muted)]">
        {Math.round(pac.democraticShare * 100)}% D
      </span>
    </span>
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
  const lobbyingYear = await latestLobbyingYear();
  const [money, topPacs, lobbying, lobbyingClients, lobbiedBills] = await Promise.all([
    getMoneyDashboard(),
    getTopPacs(10),
    getLobbyingOverview(lobbyingYear),
    getTopLobbyingClients(lobbyingYear, 8),
    getMostLobbiedBills({ years: [lobbyingYear], limit: 6 }),
  ]);
  const cycleLabel = money.cycle ? `${money.cycle - 1}–${String(money.cycle).slice(2)} cycle` : "current cycle";
  const live = money.configured && money.totals.membersWithFilings > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Money"
        title="Funding dashboard"
        description={`Campaign fundraising, PAC money, donor employers and outside spending for sitting members of Congress, ${cycleLabel}, and who is lobbying them.`}
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
          label={`Reported lobbying, ${lobbyingYear}`}
          value={formatMoney(lobbying.spend) || "$0"}
          detail={`${lobbying.clients.toLocaleString()} organizations lobbying Congress, from Lobbying Disclosure Act reports.`}
        />
        <StatCard
          label="Members with filings"
          value={money.totals.membersWithFilings.toLocaleString()}
          detail="Sitting members matched to an FEC candidate record this cycle."
        />
      </section>

      {topPacs.length > 0 ? (
        <SectionCard title="PACs giving the most to Congress">
          <DataTable
            columns={[
              "Committee",
              "Type",
              { label: "Members", align: "right" },
              { label: "Given", align: "right" },
              { label: "Party split", align: "right" },
            ]}
            rows={topPacs.map((pac) => [
              <span key={`${pac.committeeId}-name`} className="flex items-center gap-1.5">
                <Link
                  href={`/money/graph?focus=${encodeURIComponent(`c:${pac.committeeId}`)}`}
                  className="font-medium text-[var(--ink)] hover:text-[var(--accent)]"
                >
                  {pac.name}
                </Link>
              </span>,
              <span key={`${pac.committeeId}-type`} className="text-[var(--muted)]">
                {PAC_CATEGORY_LABEL[pac.category]}
              </span>,
              pac.members.toLocaleString(),
              formatMoney(pac.total),
              <PartySplit key={`${pac.committeeId}-split`} pac={pac} />,
            ])}
          />
          <p className="mt-3 text-xs text-[var(--faint)]">
            Direct contributions to members&apos; campaigns this cycle, from FEC filings. Click a committee to see everyone it funds in the money network.
          </p>
        </SectionCard>
      ) : null}

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
        <SectionCard title={`Who lobbies the most, ${lobbyingYear}`}>
          {lobbyingClients.length > 0 ? (
            <DataTable
              columns={["Organization", { label: "Firms", align: "right" }, { label: "Spent", align: "right" }]}
              rows={lobbyingClients.map((client) => [
                <Link key={client.clientKey} href={clientHref(client.clientKey)} className="font-medium text-[var(--ink)] hover:text-[var(--accent)]">
                  {client.name}
                </Link>,
                client.inHouse && client.firms === 0 ? "In-house" : client.firms.toLocaleString(),
                formatMoney(client.spend),
              ])}
            />
          ) : (
            <EmptyState title="Nothing stored yet" description="Run the lobbying sync to load Lobbying Disclosure Act reports." />
          )}
          <p className="mt-3 text-xs text-[var(--faint)]">
            Each quarter counted once per organization, amendments replacing originals.{" "}
            <Link href="/money/lobbying" className="font-medium text-[var(--accent-2)]">All lobbying →</Link>
          </p>
        </SectionCard>
      </section>

      <LobbiedBillsCard
        title={`Most-lobbied bills, ${lobbyingYear}`}
        rows={lobbiedBills}
        note="Ranked by how many organizations named the bill in their lobbying reports."
      />

      <SectionCard title="Explore the network">
        <div className="flex flex-col gap-3 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--muted)]">
            See every PAC and member of Congress in one network, and follow the money from either side.
          </p>
          <Link href="/money/graph" className="shrink-0 rounded-full bg-[var(--accent)] px-4 py-2 text-center text-sm font-semibold text-white">
            Open the money network
          </Link>
        </div>
      </SectionCard>
    </div>
  );
}
