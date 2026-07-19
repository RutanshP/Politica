"use client";

import { useState } from "react";

import { formatMoneyExact } from "@/components/funding/funding-graph-theme";
import {
  FINANCIAL_RELATIONSHIP_TYPES,
  type FundingGraphEdge,
  type FundingGraphNode,
  type FundingGraphTotals,
} from "@/types/funding-graph";

const TABS = [
  "Overview",
  "Contributions",
  "Industries",
  "PACs",
  "Lobbying",
  "Legislative",
  "Methodology",
] as const;

type TabName = (typeof TABS)[number];

function SimpleTable({
  columns,
  rows,
  emptyMessage,
}: {
  columns: string[];
  rows: React.ReactNode[][];
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-xs text-[var(--muted)]">{emptyMessage}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-[var(--line)] text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
            {columns.map((column) => (
              <th key={column} className="px-3 py-2 font-semibold">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-[var(--line)] last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 text-[var(--ink)]">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FundingTabs({
  nodes,
  edges,
  totals,
  onSelectEdge,
  onSelectNode,
}: {
  nodes: FundingGraphNode[];
  edges: FundingGraphEdge[];
  totals: FundingGraphTotals;
  onSelectEdge: (edgeId: string) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const [active, setActive] = useState<TabName>("Overview");
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  const financialEdges = edges
    .filter((edge) => (FINANCIAL_RELATIONSHIP_TYPES as readonly string[]).includes(edge.data.relationshipType))
    .sort((left, right) => (right.data.amount || 0) - (left.data.amount || 0));

  const renderTab = () => {
    if (active === "Overview") {
      return (
        <div className="grid gap-3 px-3 py-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Total receipts", totals.totalReceipts],
            ["Individual contributions", totals.individualContributions],
            ["PAC contributions", totals.pacContributions],
            ["Small-dollar", totals.smallDollarContributions],
            ["Self-funding", totals.selfFunding],
            ["Independent support", totals.independentSupport],
            ["Independent opposition", totals.independentOpposition],
          ].map(([label, amount]) => (
            <div key={String(label)} className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">{label}</p>
              <p className="mt-1 text-lg font-bold text-[var(--ink)]">{formatMoneyExact(Number(amount))}</p>
            </div>
          ))}
          <div className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Small-dollar share</p>
            <p className="mt-1 text-lg font-bold text-[var(--ink)]">{totals.smallDollarPercentage}%</p>
          </div>
        </div>
      );
    }

    if (active === "Contributions") {
      return (
        <SimpleTable
          columns={["From", "To", "Relationship", "Amount", "Transactions", "Cycle", "Basis"]}
          emptyMessage="No financial edges match the current filters."
          rows={financialEdges.map((edge) => [
            <button
              key="from"
              type="button"
              className="font-semibold text-[var(--accent)] hover:underline"
              onClick={() => onSelectNode(edge.source)}
            >
              {nodesById.get(edge.source)?.data.label || edge.source}
            </button>,
            nodesById.get(edge.target)?.data.label || edge.target,
            edge.data.label,
            <button
              key="amount"
              type="button"
              className="font-bold hover:underline"
              onClick={() => onSelectEdge(edge.id)}
            >
              {formatMoneyExact(edge.data.amount)}
            </button>,
            edge.data.transactionCount?.toLocaleString() ?? "—",
            edge.data.electionCycle ?? "—",
            edge.data.isAggregate ? "Aggregate" : "Direct",
          ])}
        />
      );
    }

    if (active === "Industries") {
      const industryNodes = nodes.filter((node) =>
        node.data.entityType === "industry" || node.data.entityType === "employer");
      return (
        <SimpleTable
          columns={["Group", "Type", "Strongest edge", "Note"]}
          emptyMessage="No industry or employer aggregates in the current graph."
          rows={industryNodes.map((node) => {
            const strongest = financialEdges.find(
              (edge) => edge.source === node.id || edge.target === node.id,
            );
            return [
              <button
                key="label"
                type="button"
                className="font-semibold text-[var(--accent)] hover:underline"
                onClick={() => onSelectNode(node.id)}
              >
                {node.data.label}
              </button>,
              node.data.entityType === "industry" ? "Industry aggregate" : "Employer aggregate",
              formatMoneyExact(strongest?.data.amount),
              "Grouped contributions -- not a direct organizational gift",
            ];
          })}
        />
      );
    }

    if (active === "PACs") {
      const pacNodes = nodes.filter((node) =>
        ["pac", "partyCommittee", "independentExpenditureGroup"].includes(node.data.entityType));
      return (
        <SimpleTable
          columns={["Committee", "Type", "Amount", "Relationship"]}
          emptyMessage="No PACs or outside groups in the current graph."
          rows={pacNodes.map((node) => {
            const strongest = financialEdges.find(
              (edge) => edge.source === node.id || edge.target === node.id,
            );
            return [
              <button
                key="label"
                type="button"
                className="font-semibold text-[var(--accent)] hover:underline"
                onClick={() => onSelectNode(node.id)}
              >
                {node.data.label}
              </button>,
              node.data.subtitle || node.data.entityType,
              formatMoneyExact(strongest?.data.amount),
              strongest?.data.label ?? "—",
            ];
          })}
        />
      );
    }

    if (active === "Lobbying") {
      const lobbyEdges = edges.filter((edge) =>
        edge.data.relationshipType === "retained" || edge.data.relationshipType === "lobbied_on");
      return (
        <SimpleTable
          columns={["From", "Relationship", "To", "Amount / filings"]}
          emptyMessage="No lobbying relationships in the current graph (or the lobbying layer is off)."
          rows={lobbyEdges.map((edge) => [
            nodesById.get(edge.source)?.data.label || edge.source,
            edge.data.label,
            nodesById.get(edge.target)?.data.label || edge.target,
            edge.data.amount
              ? formatMoneyExact(edge.data.amount)
              : `${edge.data.transactionCount ?? "—"} filings`,
          ])}
        />
      );
    }

    if (active === "Legislative") {
      const legislativeEdges = edges.filter((edge) =>
        ["member_of", "chairs", "sponsored", "cosponsored", "classified_under", "voted_on"].includes(
          edge.data.relationshipType,
        ));
      return (
        <SimpleTable
          columns={["Relationship", "Entity", "Detail"]}
          emptyMessage="No legislative connections (or the legislative layer is off)."
          rows={legislativeEdges.map((edge) => {
            const other = nodesById.get(edge.target)?.data.entityType === "politician"
              ? nodesById.get(edge.source)
              : nodesById.get(edge.target);
            return [
              edge.data.label,
              <button
                key="entity"
                type="button"
                className="font-semibold text-[var(--accent)] hover:underline"
                onClick={() => other && onSelectNode(other.id)}
              >
                {other?.data.label ?? "—"}
              </button>,
              other?.data.subtitle ?? "—",
            ];
          })}
        />
      );
    }

    return (
      <div className="space-y-3 px-4 py-4 text-xs leading-relaxed text-[var(--ink)]">
        <p className="font-semibold">How this graph is built</p>
        <ul className="list-disc space-y-1.5 pl-5 text-[var(--muted)]">
          <li>
            <span className="font-semibold text-[var(--ink)]">Direct transactions</span> (solid lines)
            are edges backed by legally recorded transfers: PAC contributions, party transfers,
            committee-to-committee transfers, and independent expenditures.
          </li>
          <li>
            <span className="font-semibold text-[var(--ink)]">Aggregates</span> (dashed lines) group
            many underlying records: all individual donors, small-dollar (&lt;$200) donors, employees
            grouped by their reported employer, and contributions grouped by industry classification.
            An &quot;Employees of X&quot; edge is <em>not</em> a contribution by the company itself --
            corporations cannot contribute directly to federal candidates.
          </li>
          <li>
            <span className="font-semibold text-[var(--ink)]">Affiliations</span> (dotted lines)
            represent organizational relationships with no money attached, such as a company being the
            employer behind an employee aggregate, or committee memberships.
          </li>
          <li>
            <span className="font-semibold text-[var(--ink)]">Lobbying</span> (long-dashed rose lines)
            comes from lobbying disclosure filings and never implies any contribution occurred.
          </li>
          <li>
            <span className="font-semibold text-[var(--ink)]">Legislative connections</span> (right
            side) are the politician&apos;s stored committee memberships, sponsored bills, and derived
            issue areas. Showing money and legislation on one canvas documents both sets of
            relationships; it does not assert that contributions caused any legislative action.
          </li>
          <li>
            Every edge is backed by one or more source records; select an edge to inspect them. The
            graph is limited to the highest-ranked relationships (by amount, transaction count,
            recency, directness, then source confidence) -- use filters to reach the rest.
          </li>
        </ul>
      </div>
    );
  };

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--line)] px-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActive(tab)}
            className={`shrink-0 border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
              active === tab
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      {renderTab()}
    </div>
  );
}
