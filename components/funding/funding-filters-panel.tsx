"use client";

import { useEffect, useState } from "react";

import { ENTITY_THEME } from "@/components/funding/funding-graph-theme";
import type { FundingGraphEntityType, FundingGraphFilters } from "@/types/funding-graph";

const FILTERABLE_NODE_TYPES: FundingGraphEntityType[] = [
  "donorAggregate",
  "pac",
  "partyCommittee",
  "independentExpenditureGroup",
  "employer",
  "industry",
  "company",
  "lobbyingFirm",
  "committee",
  "bill",
  "issue",
];

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 py-1 text-xs text-[var(--ink)]">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-[var(--accent)]" : "bg-slate-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4.5 left-0.5" : "left-0.5"
          }`}
          style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
        />
      </button>
    </label>
  );
}

export function FundingFiltersPanel({
  filters,
  availableCycles,
  showAmounts,
  animateEdges,
  onChange,
  onDisplayChange,
  onReset,
}: {
  filters: FundingGraphFilters;
  availableCycles: number[];
  showAmounts: boolean;
  animateEdges: boolean;
  onChange: (next: Partial<FundingGraphFilters>) => void;
  onDisplayChange: (next: { showAmounts?: boolean; animateEdges?: boolean }) => void;
  onReset: () => void;
}) {
  // Debounced local state for the monetary input so typing does not refetch.
  const [minimumDraft, setMinimumDraft] = useState(filters.minimumAmount?.toString() ?? "");
  // Reset the draft when the prop changes externally (e.g. filter reset) --
  // adjusting state during render instead of in an effect, per React docs.
  const [lastPropMinimum, setLastPropMinimum] = useState(filters.minimumAmount);
  if (filters.minimumAmount !== lastPropMinimum) {
    setLastPropMinimum(filters.minimumAmount);
    setMinimumDraft(filters.minimumAmount?.toString() ?? "");
  }
  useEffect(() => {
    const handle = setTimeout(() => {
      const parsed = Number(minimumDraft);
      const next = minimumDraft && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
      if (next !== filters.minimumAmount) onChange({ minimumAmount: next });
    }, 450);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minimumDraft]);

  const activeNodeTypes = new Set(filters.nodeTypes ?? FILTERABLE_NODE_TYPES);

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Filters</p>
        <button
          type="button"
          onClick={onReset}
          className="text-xs font-semibold text-[var(--accent)] hover:underline"
        >
          Reset
        </button>
      </div>

      <div>
        <label className="text-xs font-semibold text-[var(--ink)]">Election cycle</label>
        <select
          value={filters.cycle ?? ""}
          onChange={(event) =>
            onChange({ cycle: event.target.value ? Number(event.target.value) : undefined })}
          className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-xs"
        >
          <option value="">All cycles</option>
          {availableCycles.map((cycle) => (
            <option key={cycle} value={cycle}>{cycle}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-semibold text-[var(--ink)]">Minimum amount</label>
        <div className="mt-1 flex items-center gap-1 rounded-xl border border-[var(--line)] bg-white px-3 py-2">
          <span className="text-xs text-[var(--muted)]">$</span>
          <input
            inputMode="numeric"
            value={minimumDraft}
            onChange={(event) => setMinimumDraft(event.target.value.replace(/[^0-9]/g, ""))}
            placeholder="0"
            className="w-full bg-transparent text-xs outline-none"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-[var(--ink)]">Node types</p>
          <button
            type="button"
            onClick={() => onChange({ nodeTypes: undefined })}
            className="text-[10px] font-semibold text-[var(--accent)] hover:underline"
          >
            Select all
          </button>
        </div>
        <div className="mt-1.5 space-y-0.5">
          {FILTERABLE_NODE_TYPES.map((type) => {
            const theme = ENTITY_THEME[type];
            const checked = activeNodeTypes.has(type);
            return (
              <label key={type} className="flex cursor-pointer items-center gap-2 py-0.5 text-xs">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = new Set(activeNodeTypes);
                    if (checked) next.delete(type);
                    else next.add(type);
                    onChange({
                      nodeTypes: next.size === FILTERABLE_NODE_TYPES.length
                        ? undefined
                        : ([...next] as FundingGraphEntityType[]),
                    });
                  }}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: theme.color }}
                />
                <span className="text-[var(--ink)]">{theme.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="space-y-0.5 border-t border-[var(--line)] pt-3">
        <Toggle
          label="Group small donors (<$200)"
          checked={filters.groupSmallDonors}
          onChange={(next) => onChange({ groupSmallDonors: next })}
        />
        <Toggle
          label="Legislative connections"
          checked={filters.showLegislative}
          onChange={(next) => onChange({ showLegislative: next })}
        />
        <Toggle
          label="Lobbying connections"
          checked={filters.showLobbying}
          onChange={(next) => onChange({ showLobbying: next })}
        />
        <Toggle
          label="Independent expenditures"
          checked={filters.showIndependentExpenditures}
          onChange={(next) => onChange({ showIndependentExpenditures: next })}
        />
      </div>

      <div className="space-y-0.5 border-t border-[var(--line)] pt-3">
        <Toggle
          label="Show amounts on edges"
          checked={showAmounts}
          onChange={(next) => onDisplayChange({ showAmounts: next })}
        />
        <Toggle
          label="Animate money flow"
          checked={animateEdges}
          onChange={(next) => onDisplayChange({ animateEdges: next })}
        />
      </div>
    </div>
  );
}
