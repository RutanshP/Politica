import { Briefcase } from "lucide-react";
import Link from "next/link";

import { Card, CardBody, CardHeader, CardNote } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import type { LobbiedBillRow } from "@/lib/data/lobbying";
import { billHref } from "@/lib/utils";

/** Bills ranked by how many organizations lobbied on them. Renders nothing when there are none. */
export function LobbiedBillsCard({
  title,
  rows,
  note,
}: {
  title: string;
  rows: LobbiedBillRow[];
  note?: React.ReactNode;
}) {
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((row) => row.clients));

  return (
    <Card>
      <CardHeader title={title} icon={<Briefcase />} actionLabel="All lobbying" actionHref="/money/lobbying" />
      <CardBody tight>
        {rows.map((row) => (
          <Link
            key={row.billId}
            href={`${billHref(row.billId)}#lobbying`}
            className="flex items-center gap-3 rounded-[var(--r-sm)] px-2 py-2.5 transition hover:bg-white/3 [&+&]:rounded-none [&+&]:border-t [&+&]:border-[var(--line)]"
          >
            <span className="min-w-0 flex-1">
              <span className="line-clamp-1 text-[13px] font-medium text-[var(--ink)]">
                <span className="num mr-1.5 text-[var(--accent-2)]">{row.number}</span>
                {row.title}
              </span>
              <span className="mt-1 flex items-center gap-2">
                <Meter value={row.clients} max={max} className="w-24 flex-none sm:w-32" />
                <span className="text-xs text-[var(--muted)]">{row.status}</span>
              </span>
            </span>
            <span className="num flex-none text-right text-[12px] text-[var(--ink)]">
              {row.clients.toLocaleString()}
              <span className="block text-[11px] text-[var(--faint)]">orgs</span>
            </span>
          </Link>
        ))}
      </CardBody>
      {note ? <CardNote>{note}</CardNote> : null}
    </Card>
  );
}
