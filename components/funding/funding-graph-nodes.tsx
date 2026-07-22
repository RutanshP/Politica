"use client";

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

import { formatMoney, getEntityTheme } from "@/components/funding/funding-graph-theme";
import type { FundingGraphNodeData } from "@/types/funding-graph";

const hiddenHandleStyle = { opacity: 0, width: 1, height: 1, minWidth: 1, minHeight: 1 } as const;

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

interface FlowNodeShape {
  data: FundingGraphNodeData & {
    dimmed?: boolean;
    selected?: boolean;
    zoomedOut?: boolean;
  };
}

export function PoliticianFlowNode({ data }: NodeProps & FlowNodeShape) {
  const theme = getEntityTheme("politician");
  return (
    <div
      className={`rounded-[var(--r-lg)] border-2 bg-[var(--panel-2)] px-5 py-4 transition-opacity ${
        data.dimmed ? "opacity-30" : "opacity-100"
      }`}
      style={{ borderColor: theme.color, minWidth: 220 }}
    >
      <Handle type="target" position={Position.Left} style={hiddenHandleStyle} />
      <Handle type="source" position={Position.Right} style={hiddenHandleStyle} />
      <Handle id="left-out" type="source" position={Position.Left} style={hiddenHandleStyle} />
      <Handle id="right-in" type="target" position={Position.Right} style={hiddenHandleStyle} />
      <div className="flex items-center gap-3">
        <div
          // Entity colors are lifted for the dark canvas, so the initials sit dark-on-light here.
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-[var(--canvas)]"
          style={{ background: theme.color }}
        >
          {initialsOf(data.label)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[var(--ink)]">{data.label}</p>
          {data.subtitle ? (
            <p className="truncate text-xs text-[var(--muted)]">{data.subtitle}</p>
          ) : null}
          {data.amount ? (
            <p className="mt-1 text-xs font-semibold" style={{ color: theme.color }}>
              {formatMoney(data.amount)} total receipts
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function EntityFlowNode({ data }: NodeProps & FlowNodeShape) {
  const theme = getEntityTheme(data.entityType);
  const Icon = theme.icon;

  if (data.zoomedOut) {
    return (
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-full border-2 bg-[var(--panel-2)] transition-opacity ${
          data.dimmed ? "opacity-30" : "opacity-100"
        }`}
        style={{ borderColor: theme.color }}
      >
        <Handle type="target" position={Position.Left} style={hiddenHandleStyle} />
        <Handle type="source" position={Position.Right} style={hiddenHandleStyle} />
        <Icon size={16} className="shrink-0" style={{ color: theme.color }} />
      </div>
    );
  }

  return (
    <div
      className={`rounded-[var(--r-md)] border bg-[var(--panel-2)] px-3.5 py-2.5 transition-opacity ${
        data.dimmed ? "opacity-30" : "opacity-100"
      } ${data.selected ? "ring-2 ring-offset-1 ring-offset-[var(--canvas)]" : ""}`}
      style={{
        borderColor: `${theme.color}55`,
        minWidth: 168,
        maxWidth: 230,
        ...(data.selected ? { ["--tw-ring-color" as string]: theme.color } : {}),
      }}
    >
      <Handle type="target" position={Position.Left} style={hiddenHandleStyle} />
      <Handle type="source" position={Position.Right} style={hiddenHandleStyle} />
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ background: theme.softColor }}
        >
          <Icon size={15} style={{ color: theme.color }} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-[var(--ink)]">{data.label}</p>
          <p className="truncate text-[10px] text-[var(--muted)]">
            {data.subtitle || theme.label}
            {data.isAggregate ? " · aggregate" : ""}
          </p>
          {data.amount ? (
            <p className="text-[11px] font-bold" style={{ color: theme.color }}>
              {formatMoney(data.amount)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const fundingNodeTypes = {
  politician: PoliticianFlowNode,
  entity: EntityFlowNode,
};
