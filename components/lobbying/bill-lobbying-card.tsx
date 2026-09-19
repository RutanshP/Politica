import { Briefcase, ExternalLink } from "lucide-react";
import Link from "next/link";

import { Card, CardBody, CardHeader, CardNote } from "@/components/ui/card";
import { clientHref, type BillLobbying, type BillLobbyingRow } from "@/lib/data/lobbying";

const SHOWN = 10;

function LobbyingRow({ row }: { row: BillLobbyingRow }) {
  const via = row.inHouse
    ? row.firms.length > 0
      ? `In-house and ${row.firms.length === 1 ? row.firms[0] : `${row.firms.length} firms`}`
      : "In-house"
    : row.firms.length === 1
      ? `via ${row.firms[0]}`
      : `via ${row.firms.length} firms`;
  const span = row.firstQuarter && row.lastQuarter && row.firstQuarter !== row.lastQuarter
    ? `${row.firstQuarter} – ${row.lastQuarter}`
    : row.lastQuarter;

  return (
    <li className="flex items-center gap-3 border-b border-[var(--line)] px-2 py-2.5 last:border-b-0">
      <span className="min-w-0 flex-1">
        <Link href={clientHref(row.clientKey)} className="line-clamp-1 text-[13px] font-medium text-[var(--ink)] hover:text-[var(--accent-2)]">
          {row.name}
        </Link>
        <span className="mt-0.5 line-clamp-1 text-xs text-[var(--muted)]" title={row.firms.join(", ")}>
          {via}
        </span>
      </span>
      <span className="num flex-none text-right text-[11.5px] text-[var(--faint)]">
        {span}
        <span className="block">
          {row.reports} report{row.reports === 1 ? "" : "s"}
        </span>
      </span>
      {row.latestFilingUrl ? (
        <a
          href={row.latestFilingUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Latest report by ${row.name}`}
          title="Latest report"
          className="flex-none rounded-[var(--r-sm)] p-1 text-[var(--faint)] transition hover:bg-white/5 hover:text-[var(--accent-2)]"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </li>
  );
}

/** Organizations whose lobbying reports name this bill. Renders nothing when none do. */
export function BillLobbyingCard({ lobbying }: { lobbying: BillLobbying }) {
  const { rows, totalClients, totalFirms } = lobbying;
  if (rows.length === 0) return null;

  return (
    <Card id="lobbying" className="scroll-mt-24">
      <CardHeader title="Lobbying on this bill" icon={<Briefcase />} count={totalClients.toLocaleString()} actionLabel="All lobbying" actionHref="/money/lobbying" />
      <CardBody tight>
        <p className="px-2 pb-1 pt-1.5 text-[12.5px] text-[var(--muted)]">
          {totalClients.toLocaleString()} organization{totalClients === 1 ? "" : "s"} reported lobbying on this bill
          {totalFirms > 0 ? `, through ${totalFirms.toLocaleString()} lobbying firm${totalFirms === 1 ? "" : "s"}` : ""}.
        </p>
        <ul>
          {rows.slice(0, SHOWN).map((row) => (
            <LobbyingRow key={row.clientKey} row={row} />
          ))}
        </ul>
        {rows.length > SHOWN ? (
          <details className="group">
            <summary className="cursor-pointer list-none px-2 py-2.5 text-xs font-medium text-[var(--accent-2)] hover:text-[#a5adff]">
              <span className="group-open:hidden">
                {rows.length < totalClients ? `Show the ${rows.length} most active` : `Show all ${rows.length.toLocaleString()}`}
              </span>
              <span className="hidden group-open:inline">Show fewer</span>
            </summary>
            <ul>
              {rows.slice(SHOWN).map((row) => (
                <LobbyingRow key={row.clientKey} row={row} />
              ))}
            </ul>
          </details>
        ) : null}
      </CardBody>
      <CardNote>
        From Lobbying Disclosure Act reports that name this bill. Reports do not say how much of a quarter&apos;s
        spending went to any one bill, so none is attributed here.
      </CardNote>
    </Card>
  );
}
