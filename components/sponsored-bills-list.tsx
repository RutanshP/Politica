"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import type { Bill } from "@/types/civic";

const PAGE_SIZE = 24;

function statusTone(status: string) {
  const value = status.toLowerCase();
  if (value.includes("became law") || value.includes("passed") || value.includes("enacted")) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (value.includes("failed") || value.includes("vetoed")) {
    return "bg-rose-50 text-rose-700 border-rose-200";
  }
  return "bg-slate-50 text-slate-600 border-slate-200";
}

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisible(PAGE_SIZE);
          }}
          placeholder="Search by number, title, topic, or status"
          className="w-full max-w-md rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]"
        />
        <p className="text-sm text-[var(--muted)]">
          {filtered.length} of {bills.length} shown
        </p>
      </div>

      {shown.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((bill) => (
            <Link
              key={bill.id}
              href={`/bills/${bill.id}`}
              className="flex flex-col rounded-2xl border border-[var(--line)] bg-white p-4 transition hover:border-[var(--accent)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--accent)]">{bill.number}</span>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusTone(bill.status)}`}>
                  {bill.status}
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{bill.title}</p>
              {bill.latestAction ? (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {bill.latestAction}
                  {bill.lastActionAt ? ` — ${bill.lastActionAt}` : ""}
                </p>
              ) : null}
              {bill.topic ? (
                <span className="mt-3 inline-flex w-fit rounded-full bg-[var(--surface,#f4f4f5)] px-2.5 py-0.5 text-xs text-[var(--muted)]">
                  {bill.topic}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-[var(--line)] bg-white p-6 text-center text-sm text-[var(--muted)]">
          No sponsored bills match “{query}”.
        </p>
      )}

      {visible < filtered.length ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setVisible((current) => current + PAGE_SIZE)}
            className="rounded-full border border-[var(--line)] bg-white px-5 py-2 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)]"
          >
            Show more ({filtered.length - visible} remaining)
          </button>
        </div>
      ) : null}
    </div>
  );
}
