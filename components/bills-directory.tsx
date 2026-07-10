"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { StatusPill } from "@/components/status-pill";
import { WatchButton } from "@/components/watch-button";
import type { Bill, Politician } from "@/types/civic";

const PAGE_SIZE = 20;

function getSponsorSlug(bill: Bill, politicians: Politician[]) {
  const sponsor =
    politicians.find((politician) => politician.id === bill.sponsorId)
    || politicians.find((politician) => politician.name === bill.sponsorName);

  return sponsor?.slug;
}

export function BillsDirectory({
  bills,
  politicians,
}: {
  bills: Bill[];
  politicians: Politician[];
}) {
  const sessions = useMemo(() => ["All sessions", ...new Set(bills.map((bill) => bill.session))], [bills]);
  const topics = useMemo(() => ["All topics", ...new Set(bills.map((bill) => bill.topic))], [bills]);
  const sponsors = useMemo(() => ["Any sponsor", ...new Set(bills.map((bill) => bill.sponsorName))], [bills]);
  const committees = useMemo(() => ["Any committee", ...new Set(bills.map((bill) => bill.committeeName))], [bills]);
  const states = useMemo(
    () => ["All states", ...new Set(bills.map((bill) => bill.state).filter(Boolean) as string[])],
    [bills],
  );
  const chambers = useMemo(() => ["Both", ...new Set(bills.map((bill) => bill.chamber))], [bills]);
  const statuses = useMemo(() => ["All statuses", ...new Set(bills.map((bill) => bill.status))], [bills]);

  const [query, setQuery] = useState("");
  const [state, setState] = useState("All states");
  const [chamber, setChamber] = useState("Both");
  const [status, setStatus] = useState("All statuses");
  const [session, setSession] = useState("All sessions");
  const [topic, setTopic] = useState("All topics");
  const [sponsor, setSponsor] = useState("Any sponsor");
  const [committee, setCommittee] = useState("Any committee");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return bills.filter((bill) => {
      const matchesQuery =
        normalizedQuery.length === 0
        || [
          bill.number,
          bill.title,
          bill.topic,
          bill.sponsorName,
          bill.committeeName,
        ].some((value) => value.toLowerCase().includes(normalizedQuery));

      return matchesQuery
        && (state === "All states" || bill.state === state)
        && (chamber === "Both" || bill.chamber === chamber)
        && (status === "All statuses" || bill.status === status)
        && (session === "All sessions" || bill.session === session)
        && (topic === "All topics" || bill.topic === topic)
        && (sponsor === "Any sponsor" || bill.sponsorName === sponsor)
        && (committee === "Any committee" || bill.committeeName === committee);
    });
  }, [bills, chamber, committee, query, session, sponsor, state, status, topic]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-[var(--line)] bg-white p-5">
        <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
          Search bills
        </label>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Search bill numbers, sponsors, topics, committees..."
          className="mt-3 w-full rounded-full border border-slate-200/80 bg-white px-4 py-3 text-sm text-slate-700 outline-none"
        />
      </div>

      <FilterBar
        filters={[
          { label: "State", value: state, options: states },
          { label: "Chamber", value: chamber, options: chambers },
          { label: "Status", value: status, options: statuses },
          { label: "Session", value: session, options: sessions },
          { label: "Topic", value: topic, options: topics },
          { label: "Sponsor", value: sponsor, options: sponsors },
          { label: "Committee", value: committee, options: committees },
        ]}
        onChange={(label, value) => {
          setPage(1);
          if (label === "State") setState(value);
          if (label === "Chamber") setChamber(value);
          if (label === "Status") setStatus(value);
          if (label === "Session") setSession(value);
          if (label === "Topic") setTopic(value);
          if (label === "Sponsor") setSponsor(value);
          if (label === "Committee") setCommittee(value);
        }}
      />

      <DataTable
        columns={[
          "Bill number",
          "Title",
          "Jurisdiction",
          "Chamber",
          "Status",
          "Last action",
          "Sponsor",
          "Committee",
          "Watch",
        ]}
        rows={pageRows.map((bill) => {
          const sponsorSlug = getSponsorSlug(bill, politicians);

          return [
            <Link key={`${bill.id}-number`} href={`/bills/${bill.id}`} className="font-semibold text-[var(--accent)]">
              {bill.number}
            </Link>,
            <div key={`${bill.id}-title`}>
              <p className="font-semibold">{bill.title}</p>
              <p className="mt-1 text-[var(--muted)]">{bill.topic}</p>
            </div>,
            bill.jurisdiction,
            bill.chamber,
            <StatusPill key={`${bill.id}-status`} status={bill.status} />,
            <div key={`${bill.id}-action`}>
              <p>{bill.latestAction}</p>
              <p className="mt-1 text-[var(--muted)]">{bill.lastActionAt}</p>
            </div>,
            sponsorSlug ? (
              <Link key={`${bill.id}-sponsor`} href={`/politicians/${sponsorSlug}`} className="text-[var(--accent)]">
                {bill.sponsorName}
              </Link>
            ) : (
              bill.sponsorName
            ),
            <Link key={`${bill.id}-committee`} href={`/committees/${bill.committeeId}`} className="text-[var(--accent)]">
              {bill.committeeName}
            </Link>,
            <WatchButton key={`${bill.id}-watch`} />,
          ];
        })}
      />

      <Pagination page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} />
    </div>
  );
}
