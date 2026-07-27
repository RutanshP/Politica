"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Activity, FileText, Gavel, Users } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MeterRow } from "@/components/ui/meter";
import { TopicIcon, topicVisual } from "@/components/ui/topic-icon";
import { billHref, cn, formatDateLabel, normalizeCommitteeField, partyAbbrev } from "@/lib/utils";
import type { Bill, BillStatus, Committee } from "@/types/civic";

export interface CommitteeMember {
  id: string;
  slug: string;
  name: string;
  party: string;
  state: string;
  role: string;
}

type TabKey = "overview" | "members" | "bills" | "hearings";

function roleLabel(role: string) {
  if (/chair/i.test(role) && !/vice|co-?chair/i.test(role)) return "Chair";
  if (/ranking/i.test(role)) return "Ranking Member";
  if (/vice/i.test(role)) return "Vice Chair";
  return "Member";
}

function roleTone(role: string) {
  const label = roleLabel(role);
  if (label === "Chair") return "indigo" as const;
  if (label === "Ranking Member") return "rose" as const;
  if (label === "Vice Chair") return "amber" as const;
  return "slate" as const;
}

const TONES = ["indigo", "emerald", "sky", "amber", "rose", "violet", "slate"] as const;

export function CommitteeTabsView({
  committee,
  members,
  bills,
  billsCount,
  topics,
}: {
  committee: Committee;
  members: CommitteeMember[];
  bills: Bill[];
  billsCount: number;
  topics: Array<{ topic: string; count: number }>;
}) {
  const [active, setActive] = useState<TabKey>("overview");

  // Recent committee activity: the latest action on each referred bill, most recent first.
  const activity = useMemo(
    () =>
      [...bills]
        .filter((bill) => bill.latestAction)
        .sort((left, right) => Date.parse(right.lastActionAt || "") - Date.parse(left.lastActionAt || ""))
        .slice(0, 12),
    [bills],
  );

  const topicTotal = topics.reduce((sum, entry) => sum + entry.count, 0) || 1;

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "members", label: "Members", count: members.length },
    { key: "bills", label: "Referred Bills", count: billsCount },
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
                  active === tab.key ? "bg-[var(--accent-soft)] text-[var(--accent-2)]" : "bg-white/6 text-[var(--muted)]",
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {active === "overview" ? (
        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader
                title="Committee members"
                icon={<Users />}
                count={members.length}
              >
                {/*
                 * Switches tabs rather than linking to "#members": that anchor only exists while
                 * the Members tab is already rendered, so from Overview the link had nothing to
                 * scroll to and left the other members unreachable.
                 */}
                {members.length > 6 ? (
                  <button
                    type="button"
                    onClick={() => setActive("members")}
                    className="text-xs font-medium text-[var(--accent-2)] transition hover:text-[#a5adff]"
                  >
                    View all →
                  </button>
                ) : null}
              </CardHeader>
              <CardBody>
                {members.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {members.slice(0, 6).map((member) => (
                      <MemberCard key={member.id} member={member} />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--muted)]">Member roster has not been synced for this committee yet.</p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Referred bills" icon={<FileText />} count={billsCount}>
                {bills.length > 8 ? (
                  <button
                    type="button"
                    onClick={() => setActive("bills")}
                    className="text-xs font-medium text-[var(--accent-2)] transition hover:text-[#a5adff]"
                  >
                    View all →
                  </button>
                ) : null}
              </CardHeader>
              <CardBody flush>
                {bills.length > 0 ? (
                  <BillsTable bills={bills.slice(0, 8)} />
                ) : (
                  <p className="p-4 text-sm text-[var(--muted)]">No bills have been referred to this committee in the stored dataset yet.</p>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Issue domains" icon={<Gavel />} />
              <CardBody>
                {topics.length > 0 ? (
                  <div className="space-y-0.5">
                    {topics.slice(0, 6).map((entry, index) => (
                      <MeterRow
                        key={entry.topic}
                        label={entry.topic}
                        icon={<TopicIcon topic={entry.topic} />}
                        value={entry.count}
                        max={topicTotal}
                        display={`${Math.round((entry.count / topicTotal) * 100)}%`}
                        tone={topicVisual(entry.topic).tone ?? TONES[index % TONES.length]}
                        fluid
                      />
                    ))}
                    <p className="pt-2 text-[11px] text-[var(--faint)]">Share of recent referred bills by topic.</p>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--muted)]">No referred-bill topics to chart yet.</p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Recent committee activity" icon={<Activity />} />
              <CardBody tight>
                {activity.length > 0 ? (
                  <ul className="divide-y divide-[var(--line)]">
                    {activity.map((bill) => (
                      <li key={bill.id} className="flex gap-3 px-2 py-3">
                        <span className="mt-0.5 flex-none text-[var(--muted)] [&>svg]:h-3.5 [&>svg]:w-3.5">
                          <TopicIcon topic={bill.topic} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[13px] leading-snug text-[var(--ink)]">{bill.latestAction}</p>
                          <p className="mt-0.5 text-xs text-[var(--muted)]">
                            <Link href={billHref(bill.id)} className="font-semibold text-[var(--accent-2)]">
                              {bill.number}
                            </Link>
                            {bill.lastActionAt ? ` · ${formatDateLabel(bill.lastActionAt)}` : ""}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-2 py-3 text-sm text-[var(--muted)]">No recent activity recorded for this committee&apos;s bills.</p>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      ) : null}

      {active === "members" ? (
        <div id="members">
          {members.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((member) => (
                <MemberCard key={member.id} member={member} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Member roster has not been synced for this committee yet.</p>
          )}
        </div>
      ) : null}

      {active === "bills" ? (
        <Card>
          <CardBody flush>
            {bills.length > 0 ? (
              <>
                <BillsTable bills={bills} />
                {billsCount > bills.length ? (
                  <p className="border-t border-[var(--line)] px-4 py-3 text-xs text-[var(--muted)]">
                    Showing the {bills.length} most recently active of {billsCount.toLocaleString()} bills referred to this committee.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="p-4 text-sm text-[var(--muted)]">No bills have been referred to this committee in the stored dataset yet.</p>
            )}
          </CardBody>
        </Card>
      ) : null}

      {active === "hearings" ? (
        <Card>
          <CardBody>
            <p className="text-sm text-[var(--muted)]">
              Upcoming hearing: <span className="text-[var(--ink)]">{normalizeCommitteeField(committee.hearing, "No hearing scheduled")}</span>
            </p>
            <p className="mt-2 text-xs text-[var(--faint)]">
              Hearing agendas and schedules are published by the committee and are not part of the current Congress.gov sync.
            </p>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function MemberCard({ member }: { member: CommitteeMember }) {
  return (
    <Link
      href={`/politicians/${member.slug}`}
      className="flex items-center gap-3 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-3.5 transition hover:border-[var(--line-2)]"
    >
      <Avatar name={member.name} id={member.id} party={member.party} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--ink)]">{member.name}</p>
        <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
          {partyAbbrev(member.party)} · {member.state}
        </p>
      </div>
      <Badge tone={roleTone(member.role)}>{roleLabel(member.role)}</Badge>
    </Link>
  );
}

function BillsTable({ bills }: { bills: Bill[] }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {["Bill", "Title", "Status", "Latest action"].map((col) => (
              <th
                key={col}
                scope="col"
                className="whitespace-nowrap border-b border-[var(--line)] bg-[var(--panel-2)] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bills.map((bill) => (
            <tr key={bill.id} className="border-b border-[var(--line)] transition last:border-b-0 hover:bg-white/2">
              <td className="whitespace-nowrap px-3.5 py-3 align-top">
                <Link href={billHref(bill.id)} className="font-semibold text-[var(--accent-2)]">
                  {bill.number}
                </Link>
              </td>
              <td className="px-3.5 py-3 align-top text-[var(--ink)]">{bill.title}</td>
              <td className="px-3.5 py-3 align-top">
                <StatusBadge status={bill.status as BillStatus} />
              </td>
              <td className="px-3.5 py-3 align-top text-xs text-[var(--muted)]">
                {bill.latestAction}
                {bill.lastActionAt ? (
                  <span className="mt-0.5 block text-[var(--faint)]">{formatDateLabel(bill.lastActionAt)}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
