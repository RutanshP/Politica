"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge, Tag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/icon-tile";
import { TopicIcon, topicVisual } from "@/components/ui/topic-icon";
import { BILL_STATUS_TONE } from "@/components/ui/tones";
import type { Bill } from "@/types/civic";

const PAGE_SIZE = 24;

export function SponsoredBillsList({ bills }: { bills: Bill[] }) {
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return bills;
    return bills.filter((bill) =>
      [bill.number, bill.title, bill.topic, bill.status, bill.latestAction]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(needle)),
    );
  }, [bills, query]);

  const shown = filtered.slice(0, visible);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex min-w-0 max-w-md flex-1 items-center">
          <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-[var(--faint)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisible(PAGE_SIZE);
            }}
            placeholder="Search by number, title, topic, or status"
            aria-label="Search sponsored bills"
            className="h-9.5 w-full min-w-0 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] pl-10 pr-3.5 text-[13.5px] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--line-2)] focus:bg-[var(--panel-2)]"
          />
        </div>
        <p className="num text-xs text-[var(--muted)]">
          {filtered.length} of {bills.length} shown
        </p>
      </div>

      {shown.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((bill) => (
            <Link
              key={bill.id}
              href={`/bills/${bill.id}`}
              className="flex flex-col gap-2 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] p-3.5 transition hover:border-[var(--line-2)] hover:bg-[var(--panel-2)]"
            >
              <div className="flex items-center gap-2.5">
                <IconTile tone={topicVisual(bill.topic).tone}>
                  <TopicIcon topic={bill.topic} />
                </IconTile>
                <span className="text-[13px] font-semibold text-[var(--accent-2)]">
                  {bill.number}
                </span>
                <Badge tone={BILL_STATUS_TONE[bill.status] ?? "slate"} className="ml-auto">
                  {bill.status}
                </Badge>
              </div>
              <p className="text-[13px] font-medium leading-snug text-[var(--ink)]">
                {bill.title}
              </p>
              {bill.latestAction ? (
                <p className="text-xs text-[var(--muted)]">
                  {bill.latestAction}
                  {bill.lastActionAt ? ` · ${bill.lastActionAt}` : ""}
                </p>
              ) : null}
              {bill.topic ? <Tag className="mt-auto w-fit">{bill.topic}</Tag> : null}
            </Link>
          ))}
        </div>
      ) : (
        <p className="rounded-[var(--r-md)] border border-dashed border-[var(--line-2)] p-6 text-center text-[13px] text-[var(--muted)]">
          No sponsored bills match “{query}”.
        </p>
      )}

      {visible < filtered.length ? (
        <div className="flex justify-center">
          <Button onClick={() => setVisible((current) => current + PAGE_SIZE)}>
            Show more ({filtered.length - visible} remaining)
          </Button>
        </div>
      ) : null}
    </div>
  );
}
