"use client";

import Link from "next/link";
import { useState } from "react";

import { cn, normalizeCommitteeField } from "@/lib/utils";
import type { Bill, Committee, Politician } from "@/types/civic";

type TabKey = "overview" | "members" | "bills" | "hearings";

/**
 * Committee detail body with working tabs. The strip used to be four links that all pointed back
 * at the same page, so nothing switched. This keeps the fetched roster and referred bills in the
 * client and toggles which section shows, with real counts on the tabs.
 */
export function CommitteeTabsView({
  committee,
  members,
  bills,
  billsCount,
  sector,
}: {
  committee: Committee;
  members: Politician[];
  bills: Bill[];
  billsCount: number;
  sector: string;
}) {
  const [active, setActive] = useState<TabKey>("overview");

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "members", label: "Members", count: members.length },
    { key: "bills", label: "Bills", count: billsCount },
    { key: "hearings", label: "Hearings" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex gap-0.5 overflow-x-auto border-b border-[var(--line)]">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            aria-current={active === tab.key ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13.5px] font-medium transition",
              active === tab.key
                ? "border-[var(--accent)] text-[var(--ink)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]",
            )}
          >
            {tab.label}
            {tab.count != null ? (
              <span
                className={cn(
                  "num rounded-full px-1.5 py-px text-[11px] font-semibold",
                  active === tab.key
                    ? "bg-[var(--accent-soft)] text-[var(--accent-2)]"
                    : "bg-white/6 text-[var(--muted)]",
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {active === "overview" ? (
        <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--panel)] p-6">
          <h2 className="text-sm font-semibold text-[var(--ink)]">Committee overview</h2>
          <div className="mt-4 grid gap-x-8 gap-y-3 text-sm text-[var(--muted)] md:grid-cols-2">
            <p>Sector: <span className="text-[var(--ink)]">{sector}</span></p>
            <p>Jurisdiction: <span className="text-[var(--ink)]">{committee.jurisdiction}</span></p>
            <p>Chair: <span className="text-[var(--ink)]">{normalizeCommitteeField(committee.chair, "Not synced yet")}</span></p>
            <p>Ranking member: <span className="text-[var(--ink)]">{normalizeCommitteeField(committee.rankingMember, "Not synced yet")}</span></p>
            <p>Phone: <span className="text-[var(--ink)]">{committee.contactPhone || "Not available yet"}</span></p>
            <p>
              Contact:{" "}
              {committee.contactUrl ? (
                <a href={committee.contactUrl} className="font-semibold text-[var(--accent-2)]">Committee site</a>
              ) : (
                <span className="text-[var(--ink)]">Not available yet</span>
              )}
            </p>
            <p className="md:col-span-2">Address: <span className="text-[var(--ink)]">{committee.contactAddress || "Not available yet"}</span></p>
            <p className="md:col-span-2">
              Subcommittees:{" "}
              <span className="text-[var(--ink)]">
                {committee.subcommittees?.length
                  ? committee.subcommittees.map((item) => item.name).join(", ")
                  : "None stored yet"}
              </span>
            </p>
          </div>
        </div>
      ) : null}

      {active === "members" ? (
        members.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {members.map((member) => (
              <Link
                key={member.id}
                href={`/politicians/${member.slug}`}
                className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-5 transition hover:border-[var(--line-2)]"
              >
                <p className="text-sm font-semibold text-[var(--ink)]">{member.name}</p>
                <p className="mt-1 text-sm text-[var(--muted)]">{member.party} · {member.state}</p>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">Member roster has not been synced for this committee yet.</p>
        )
      ) : null}

      {active === "bills" ? (
        bills.length > 0 ? (
          <div className="space-y-3">
            {bills.map((bill) => (
              <Link
                key={bill.id}
                href={`/bills/${bill.id}`}
                className="block rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-4 transition hover:border-[var(--line-2)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--accent-2)]">{bill.number}</p>
                  <span className="shrink-0 text-xs text-[var(--muted)]">{bill.status}</span>
                </div>
                <p className="mt-1 text-sm text-[var(--ink)]">{bill.title}</p>
                {bill.latestAction ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">{bill.latestAction}</p>
                ) : null}
              </Link>
            ))}
            {billsCount > bills.length ? (
              <p className="pt-1 text-xs text-[var(--muted)]">
                Showing the {bills.length} most recent of {billsCount} bills referred to this committee.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">No bills have been referred to this committee in the stored dataset yet.</p>
        )
      ) : null}

      {active === "hearings" ? (
        <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--panel)] p-6 text-sm text-[var(--muted)]">
          <p>Upcoming hearing: <span className="text-[var(--ink)]">{normalizeCommitteeField(committee.hearing, "No hearing scheduled")}</span></p>
          <p className="mt-2 text-xs">Hearing schedules are published by the committee; detailed agendas are not part of the current sync.</p>
        </div>
      ) : null}
    </div>
  );
}
