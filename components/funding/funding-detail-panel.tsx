"use client";

import { Expand, ExternalLink, Info, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { formatMoneyExact, getEntityTheme } from "@/components/funding/funding-graph-theme";
import type {
  FundingGraphEdge,
  FundingGraphNode,
  FundingGraphTotals,
  FundingSourceRecord,
} from "@/types/funding-graph";

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-xs">
      <span className="shrink-0 text-[var(--muted)]">{label}</span>
      <span className="text-right font-semibold text-[var(--ink)]">{value}</span>
    </div>
  );
}

function EdgeSourceRecords({ edgeId }: { edgeId: string }) {
  const [records, setRecords] = useState<FundingSourceRecord[] | undefined>();
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 5;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/graph/edges/${encodeURIComponent(edgeId)}/records?page=${page}&pageSize=${pageSize}`)
      .then((response) => (response.ok ? response.json() : { records: [], total: 0 }))
      .then((payload) => {
        if (cancelled) return;
        setRecords(payload.records || []);
        setTotal(payload.total || 0);
      })
      .catch(() => {
        if (!cancelled) setRecords([]);
      });
    return () => {
      cancelled = true;
    };
  }, [edgeId, page]);

  if (records === undefined) {
    return <p className="mt-2 text-xs text-[var(--muted)]">Loading source records…</p>;
  }
  if (records.length === 0) {
    return (
      <p className="mt-2 text-xs text-[var(--muted)]">
        No itemized records stored for this edge yet. The edge totals come from the source filing
        referenced by the sync.
      </p>
    );
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-2 space-y-1.5">
      {records.map((record) => (
        <div key={record.id} className="rounded-xl border border-[var(--line)] bg-slate-50 px-3 py-2 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-[var(--ink)]">
              {record.contributor_name || record.record_type.replace(/_/g, " ")}
            </span>
            <span className="font-bold text-[var(--ink)]">{formatMoneyExact(record.amount ?? undefined)}</span>
          </div>
          <p className="mt-0.5 text-[10px] text-[var(--muted)]">
            {[record.occurred_on, record.contributor_employer, record.contributor_occupation, record.description]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      ))}
      {pageCount > 1 ? (
        <div className="flex items-center justify-between pt-1 text-xs">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
            className="font-semibold text-[var(--accent)] disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-[var(--muted)]">{page} / {pageCount}</span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => current + 1)}
            className="font-semibold text-[var(--accent)] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function FundingDetailPanel({
  selectedNode,
  selectedEdge,
  nodesById,
  edges,
  totals,
  centerNodeId,
  onClose,
  onExpandNode,
  onMakeCenter,
  expandDisabled,
}: {
  selectedNode?: FundingGraphNode;
  selectedEdge?: FundingGraphEdge;
  nodesById: Map<string, FundingGraphNode>;
  edges: FundingGraphEdge[];
  totals: FundingGraphTotals;
  centerNodeId: string;
  onClose: () => void;
  onExpandNode: (nodeId: string) => void;
  onMakeCenter: (nodeId: string) => void;
  expandDisabled: boolean;
}) {
  if (selectedEdge) {
    const source = nodesById.get(selectedEdge.source);
    const target = nodesById.get(selectedEdge.target);
    return (
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Relationship</p>
            <p className="mt-1 text-sm font-bold text-[var(--ink)]">
              {source?.data.label} → {target?.data.label}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-slate-100">
            <X size={14} />
          </button>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-white px-3 py-2">
          <DetailRow label="Type" value={selectedEdge.data.label} />
          {selectedEdge.data.amount !== undefined ? (
            <DetailRow label="Amount" value={formatMoneyExact(selectedEdge.data.amount)} />
          ) : null}
          {selectedEdge.data.transactionCount !== undefined ? (
            <DetailRow label="Transactions" value={selectedEdge.data.transactionCount.toLocaleString()} />
          ) : null}
          {selectedEdge.data.electionCycle ? (
            <DetailRow label="Cycle" value={selectedEdge.data.electionCycle} />
          ) : null}
          {selectedEdge.data.occurredAt ? (
            <DetailRow label="As of" value={new Date(selectedEdge.data.occurredAt).toLocaleDateString()} />
          ) : null}
          <DetailRow
            label="Basis"
            value={selectedEdge.data.isAggregate ? "Aggregated from multiple records" : "Direct transaction(s)"}
          />
          <DetailRow label="Source records" value={selectedEdge.data.sourceCount.toLocaleString()} />
        </div>
        {selectedEdge.data.isAggregate ? (
          <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[10px] leading-relaxed text-amber-800">
            <Info size={12} className="mt-0.5 shrink-0" />
            This is an aggregate of many underlying transactions, not a single direct contribution.
          </p>
        ) : null}
        <div>
          <p className="text-xs font-semibold text-[var(--ink)]">Source records</p>
          <EdgeSourceRecords edgeId={selectedEdge.id} />
        </div>
      </div>
    );
  }

  if (selectedNode) {
    const theme = getEntityTheme(selectedNode.data.entityType);
    const Icon = theme.icon;
    const connected = edges.filter(
      (edge) => edge.source === selectedNode.id || edge.target === selectedNode.id,
    );
    const isPolitician = selectedNode.data.entityType === "politician";
    const isCenter = selectedNode.id === centerNodeId;
    const href = selectedNode.data.metadata?.href;

    return (
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              style={{ background: theme.softColor }}
            >
              <Icon size={16} style={{ color: theme.color }} />
            </div>
            <div>
              <p className="text-sm font-bold text-[var(--ink)]">{selectedNode.data.label}</p>
              <p className="text-[10px] text-[var(--muted)]">
                {selectedNode.data.subtitle || theme.label}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-slate-100">
            <X size={14} />
          </button>
        </div>

        {isPolitician && isCenter ? (
          <div className="rounded-2xl border border-[var(--line)] bg-white px-3 py-2">
            <DetailRow label="Total receipts" value={formatMoneyExact(totals.totalReceipts)} />
            <DetailRow label="Individual contributions" value={formatMoneyExact(totals.individualContributions)} />
            <DetailRow label="PAC contributions" value={formatMoneyExact(totals.pacContributions)} />
            <DetailRow
              label="Small-dollar"
              value={`${formatMoneyExact(totals.smallDollarContributions)} (${totals.smallDollarPercentage}%)`}
            />
            <DetailRow label="Self-funding" value={formatMoneyExact(totals.selfFunding)} />
            <DetailRow label="Independent support" value={formatMoneyExact(totals.independentSupport)} />
            <DetailRow label="Independent opposition" value={formatMoneyExact(totals.independentOpposition)} />
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--line)] bg-white px-3 py-2">
            <DetailRow label="Entity type" value={theme.label} />
            {selectedNode.data.isAggregate ? <DetailRow label="Basis" value="Aggregate grouping" /> : null}
            {selectedNode.data.metadata?.aggregationType ? (
              <DetailRow label="Grouping" value={String(selectedNode.data.metadata.aggregationType)} />
            ) : null}
            {selectedNode.data.metadata?.contributorCount ? (
              <DetailRow
                label="Contributors"
                value={Number(selectedNode.data.metadata.contributorCount).toLocaleString()}
              />
            ) : null}
            {selectedNode.data.metadata?.pacType ? (
              <DetailRow label="PAC type" value={String(selectedNode.data.metadata.pacType)} />
            ) : null}
            {selectedNode.data.metadata?.role ? (
              <DetailRow label="Role" value={String(selectedNode.data.metadata.role)} />
            ) : null}
            {selectedNode.data.metadata?.status ? (
              <DetailRow label="Status" value={String(selectedNode.data.metadata.status)} />
            ) : null}
            <DetailRow label="Graph connections" value={connected.length} />
          </div>
        )}

        {selectedNode.data.metadata?.methodology ? (
          <p className="flex items-start gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-[10px] leading-relaxed text-[var(--muted)]">
            <Info size={12} className="mt-0.5 shrink-0" />
            {String(selectedNode.data.metadata.methodology)}
          </p>
        ) : null}
        {selectedNode.data.metadata?.note ? (
          <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[10px] leading-relaxed text-amber-800">
            <Info size={12} className="mt-0.5 shrink-0" />
            {String(selectedNode.data.metadata.note)}
          </p>
        ) : null}

        <div>
          <p className="text-xs font-semibold text-[var(--ink)]">Relationships</p>
          <div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto">
            {connected.slice(0, 12).map((edge) => {
              const other = edge.source === selectedNode.id
                ? nodesById.get(edge.target)
                : nodesById.get(edge.source);
              return (
                <div key={edge.id} className="rounded-xl border border-[var(--line)] bg-white px-3 py-1.5 text-xs">
                  <span className="text-[var(--muted)]">{edge.data.label}</span>{" "}
                  <span className="font-semibold text-[var(--ink)]">{other?.data.label}</span>
                  {edge.data.amount ? (
                    <span className="float-right font-bold text-[var(--ink)]">
                      {formatMoneyExact(edge.data.amount)}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-[var(--line)] pt-3">
          {!isCenter ? (
            <>
              <button
                type="button"
                disabled={expandDisabled}
                onClick={() => onExpandNode(selectedNode.id)}
                className="flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                <Expand size={12} /> Expand
              </button>
              <button
                type="button"
                onClick={() => onMakeCenter(selectedNode.id)}
                className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink)]"
              >
                Make center
              </button>
            </>
          ) : null}
          {typeof href === "string" && href ? (
            <Link
              href={href}
              className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--accent)]"
            >
              <ExternalLink size={12} /> Open page
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center">
      <Info size={18} className="text-[var(--muted)]" />
      <p className="text-xs text-[var(--muted)]">
        Select a node or edge in the graph to inspect its relationships and the records behind them.
      </p>
    </div>
  );
}
