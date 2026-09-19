import { Briefcase, Building2, FileText, Search, Users } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { formatMoney } from "@/components/funding/funding-graph-theme";
import { LobbyingMethodNote, QuarterBars, YearSwitch } from "@/components/lobbying/lobbying-parts";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MeterRow } from "@/components/ui/meter";
import { StatTile } from "@/components/ui/stat-tile";
import { CellSub, CellTitle, Table } from "@/components/ui/table";
import {
  clientHref,
  currentCongressYears,
  getLobbyingIssues,
  getLobbyingOverview,
  getMostLobbiedBills,
  getTopLobbyingClients,
  getTopLobbyingFirms,
  latestLobbyingYear,
} from "@/lib/data/lobbying";
import { billHref } from "@/lib/utils";

export const revalidate = 21600;

export default async function LobbyingPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; q?: string }>;
}) {
  const params = await searchParams;
  const years = currentCongressYears();
  const requested = Number(params.year);
  const year = years.includes(requested) ? requested : await latestLobbyingYear();
  const query = params.q?.trim().slice(0, 80) || "";

  const [overview, clients, firms, bills, issues] = await Promise.all([
    getLobbyingOverview(year),
    getTopLobbyingClients(year, query ? 50 : 15, query || undefined),
    getTopLobbyingFirms(year, 10),
    getMostLobbiedBills({ years: [year], limit: 12 }),
    getLobbyingIssues(year),
  ]);

  const hrefFor = (nextYear: number) => `/money/lobbying?year=${nextYear}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const reportedQuarters = new Set(overview.quarters.map((quarter) => quarter.quarter));
  const quarterBars = [1, 2, 3, 4].map((quarter) => ({
    label: `Q${quarter}`,
    spend: overview.quarters.find((row) => row.quarter === quarter)?.spend ?? 0,
    pending: !reportedQuarters.has(quarter),
  }));
  const topIssues = issues.slice(0, 12);
  const maxIssueClients = Math.max(1, ...topIssues.map((issue) => issue.clients));

  if (overview.reports === 0) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Money" title="Lobbying" description="Who is paying to influence Congress, and on which bills." />
        <EmptyState
          title="No lobbying reports stored yet"
          description="Run the lobbying sync to load Lobbying Disclosure Act reports for the current Congress."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Money"
        title="Lobbying"
        description={`Who paid to influence Congress in ${year}, which firms they hired, and the bills their reports name.`}
        actions={<YearSwitch years={years} active={year} hrefFor={hrefFor} />}
      />

      <section className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={`Reported lobbying, ${year}`} value={formatMoney(overview.spend) || "$0"} icon={<Briefcase />} tone="indigo" />
        <StatTile label="Organizations lobbying" value={overview.clients.toLocaleString()} icon={<Building2 />} tone="sky" />
        <StatTile label="Lobbying firms" value={overview.firms.toLocaleString()} icon={<Users />} tone="amber" />
        <StatTile label="Quarterly reports" value={overview.reports.toLocaleString()} icon={<FileText />} tone="emerald" />
      </section>

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] xl:items-start">
        <Card>
          <CardHeader title={`Spending by quarter, ${year}`} />
          <CardBody>
            <QuarterBars quarters={quarterBars} />
            <p className="mt-3 text-[11.5px] text-[var(--faint)]">
              Reports are due 20 days after each quarter ends, and late and amended ones keep arriving for months.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="What they lobby on">
            <span className="text-[11px] text-[var(--faint)]">organizations</span>
          </CardHeader>
          <CardBody>
            {topIssues.map((issue) => (
              <MeterRow
                key={issue.code}
                label={issue.name}
                value={issue.clients}
                max={maxIssueClients}
                display={issue.clients.toLocaleString()}
                fluid
              />
            ))}
          </CardBody>
        </Card>
      </div>

      <Card id="organizations">
        <CardHeader title={query ? `Organizations matching “${query}”` : "Who spends the most"} count={clients.length || undefined}>
          <form action="/money/lobbying" className="flex items-center gap-2 rounded-full border border-[var(--line-2)] bg-[var(--panel-2)] px-3">
            <input type="hidden" name="year" value={year} />
            <Search className="h-3.5 w-3.5 text-[var(--faint)]" aria-hidden="true" />
            <input
              name="q"
              defaultValue={query}
              placeholder="Find an organization…"
              aria-label="Find an organization"
              className="h-8 w-44 bg-transparent text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--faint)] sm:w-60"
            />
          </form>
        </CardHeader>
        <CardBody flush>
          <Table
            columns={[
              "Organization",
              { label: "Spent", align: "right" },
              { label: "Firms hired", align: "right" },
              { label: "Bills named", align: "right" },
            ]}
            emptyMessage={query ? `No organization matching “${query}” reported lobbying in ${year}.` : "No reports stored."}
            rows={clients.map((client) => [
              <Link key="name" href={clientHref(client.clientKey)} className="flex min-w-[13rem] flex-col hover:text-[var(--accent-2)]">
                <CellTitle>{client.name}</CellTitle>
                {client.inHouse ? <CellSub>Lobbies in-house</CellSub> : null}
              </Link>,
              <span key="spend" className="num">{formatMoney(client.spend) || "—"}</span>,
              <span key="firms" className="num text-[var(--muted)]">{client.firms || "—"}</span>,
              <span key="bills" className="num text-[var(--muted)]">{client.bills || "—"}</span>,
            ])}
          />
        </CardBody>
        {query ? (
          <div className="border-t border-[var(--line)] px-4 py-2.5">
            <Link href={hrefFor(year).replace(/&q=.*$/, "")} className="text-xs font-medium text-[var(--accent-2)]">
              Clear search
            </Link>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-3.5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Most-lobbied bills" count={bills.length || undefined} />
          <CardBody flush>
            <Table
              columns={["Bill", { label: "Organizations", align: "right" }, { label: "Latest", align: "right" }]}
              emptyMessage="No reports named a stored bill."
              rows={bills.map((bill) => [
                <Link key="bill" href={`${billHref(bill.billId)}#lobbying`} className="flex min-w-[12rem] flex-col hover:text-[var(--accent-2)]">
                  <CellTitle>{bill.number}</CellTitle>
                  <CellSub className="line-clamp-1">{bill.title}</CellSub>
                </Link>,
                <span key="clients" className="num">{bill.clients.toLocaleString()}</span>,
                <span key="last" className="num text-xs text-[var(--muted)]">{bill.lastQuarter ?? "—"}</span>,
              ])}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Biggest lobbying firms" count={firms.length || undefined} />
          <CardBody flush>
            <Table
              columns={["Firm", { label: "Income", align: "right" }, { label: "Clients", align: "right" }]}
              rows={firms.map((firm) => [
                <CellTitle key="firm">{firm.name}</CellTitle>,
                <span key="income" className="num">{formatMoney(firm.income) || "—"}</span>,
                <span key="clients" className="num text-[var(--muted)]">{firm.clients.toLocaleString()}</span>,
              ])}
            />
          </CardBody>
        </Card>
      </div>

      <LobbyingMethodNote />
    </div>
  );
}
