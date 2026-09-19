import { Briefcase, ExternalLink, FileText, Layers, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { formatMoney } from "@/components/funding/funding-graph-theme";
import { LobbyingMethodNote, QuarterBars } from "@/components/lobbying/lobbying-parts";
import { PageHeader } from "@/components/page-header";
import { WatchButton } from "@/components/watch-button";
import { Tag } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { CellSub, CellTitle, Table } from "@/components/ui/table";
import { clientHref, getLobbyingClient } from "@/lib/data/lobbying";
import { billHref } from "@/lib/utils";

export const revalidate = 21600;

type Params = Promise<{ client: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { client } = await params;
  const detail = await getLobbyingClient(decodeURIComponent(client));
  return { title: detail ? `${detail.name} · Lobbying` : "Lobbying" };
}

export default async function LobbyingClientPage({ params }: { params: Params }) {
  const { client } = await params;
  const detail = await getLobbyingClient(decodeURIComponent(client));
  if (!detail) notFound();

  const outsideFirms = detail.firms.filter((firm) => !firm.inHouse);
  const latestYear = detail.quarters.at(-1)?.year;
  const yearQuarters = latestYear
    ? [1, 2, 3, 4].map((quarter) => {
        const row = detail.quarters.find((item) => item.year === latestYear && item.quarter === quarter);
        return { label: `Q${quarter} ${latestYear}`, spend: row?.spend ?? 0, pending: !row };
      })
    : [];
  const earlier = detail.quarters.filter((row) => row.year !== latestYear);

  return (
    <div className="space-y-5">
      <BackLink fallbackHref="/money/lobbying" label="Lobbying" />
      <PageHeader
        eyebrow="Lobbying client"
        title={detail.name}
        description={
          detail.inHouse
            ? "Lobbies Congress with its own staff and reports its total lobbying expense, which includes anything it paid outside firms."
            : "Lobbies Congress through the outside firms below, which report what it paid them."
        }
        actions={
          <WatchButton
            item={{
              id: `lobbying:${detail.clientKey}`,
              type: "lobbying",
              label: detail.name,
              subtitle: "Lobbying client",
              href: clientHref(detail.clientKey),
            }}
          />
        }
      />

      <section className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Reported spend, this Congress" value={formatMoney(detail.totalSpend) || "$0"} icon={<Briefcase />} tone="indigo" />
        <StatTile label="Outside firms hired" value={outsideFirms.length.toLocaleString()} icon={<Users />} tone="amber" />
        <StatTile label="Bills named in its reports" value={detail.bills.length.toLocaleString()} icon={<FileText />} tone="sky" />
        <StatTile label="Issue areas" value={detail.issues.length.toLocaleString()} icon={<Layers />} tone="emerald" />
      </section>

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={latestYear ? `Spending by quarter, ${latestYear}` : "Spending by quarter"} />
          <CardBody>
            <QuarterBars quarters={yearQuarters} />
            {earlier.length > 0 ? (
              <p className="mt-3 text-[12px] text-[var(--muted)]">
                Earlier this Congress:{" "}
                {earlier.map((row) => `${row.label} ${formatMoney(row.spend) || "$0"}`).join(" · ")}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Issues it lobbied on" count={detail.issues.length || undefined} />
          <CardBody>
            <div className="flex flex-wrap gap-1.5">
              {detail.issues.map((issue) => (
                <Tag key={issue.code}>
                  {issue.name} <span className="num ml-1 text-[var(--faint)]">{issue.reports}</span>
                </Tag>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card id="bills">
        <CardHeader title="Bills named in its reports" count={detail.bills.length || undefined} />
        <CardBody flush>
          <Table
            columns={["Bill", "Status", { label: "Reports", align: "right" }, { label: "Latest", align: "right" }]}
            emptyMessage="Its reports describe issues without naming a stored bill."
            rows={detail.bills.map((bill) => [
              <Link key="bill" href={`${billHref(bill.billId)}#lobbying`} className="flex min-w-[12rem] flex-col hover:text-[var(--accent-2)]">
                <CellTitle>{bill.number}</CellTitle>
                <CellSub className="line-clamp-1">{bill.title}</CellSub>
              </Link>,
              <span key="status" className="text-xs text-[var(--muted)]">{bill.status}</span>,
              <span key="reports" className="num">{bill.reports}</span>,
              <span key="last" className="num text-xs text-[var(--muted)]">{bill.lastQuarter ?? "—"}</span>,
            ])}
          />
        </CardBody>
      </Card>

      <div className="grid gap-3.5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Who lobbied for it" count={detail.firms.length || undefined} />
          <CardBody flush>
            <Table
              columns={["Registrant", { label: "Reported", align: "right" }, { label: "Latest", align: "right" }]}
              rows={detail.firms.map((firm) => [
                <span key="firm" className="flex flex-col">
                  <CellTitle>{firm.name}</CellTitle>
                  <CellSub>{firm.inHouse ? "In-house" : "Outside firm"}</CellSub>
                </span>,
                <span key="amount" className="num">{firm.amount > 0 ? formatMoney(firm.amount) : <span className="text-[var(--muted)]">Under $5K</span>}</span>,
                <span key="last" className="num text-xs text-[var(--muted)]">{firm.lastQuarter ?? "—"}</span>,
              ])}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Reports" count={detail.reports.length || undefined} />
          <CardBody tight>
            <ul className="max-h-[26rem] overflow-auto">
              {detail.reports.map((report) => (
                <li key={report.url} className="border-b border-[var(--line)] last:border-b-0">
                  <a
                    href={report.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-[var(--r-sm)] px-2 py-2.5 text-[13px] transition hover:bg-white/3"
                  >
                    <span className="num w-16 flex-none text-xs text-[var(--muted)]">{report.quarter}</span>
                    <span className="min-w-0 flex-1 truncate text-[var(--ink)]">{report.inHouse ? "In-house report" : report.firm}</span>
                    <span className="num flex-none text-xs text-[var(--muted)]">
                      {report.amount === null ? "—" : formatMoney(report.amount) || "$0"}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 flex-none text-[var(--faint)]" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <LobbyingMethodNote />
    </div>
  );
}
