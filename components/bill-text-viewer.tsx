"use client";

import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";

import type { BillTextDocument, BillTextNode } from "@/lib/adapters/bill-text";
import { cn } from "@/lib/utils";

// A long bill starts collapsed so the browser never paints hundreds of pages at once; a short one
// opens fully. Threshold in characters (~10 pages).
const COLLAPSE_THRESHOLD = 30_000;

function NodeContent({ node }: { node: BillTextNode }) {
  const heading = [node.enum, node.header].filter(Boolean).join(" ").trim();
  const indent = Math.min(node.level, 6) * 16;

  return (
    <div
      style={{ marginLeft: indent }}
      className={cn(
        node.quoted
          && "rounded-md border-l-2 border-[var(--line-2)] bg-white/3 py-2 pl-3 pr-2",
      )}
    >
      {heading ? (
        <p className={cn("font-semibold text-[var(--ink)]", node.level === 0 ? "text-base" : "text-sm")}>
          {heading}
        </p>
      ) : null}
      {node.text ? (
        <p className="mt-1 text-[13px] leading-7 text-[var(--muted)]">{node.text}</p>
      ) : null}
      {node.children.length > 0 ? (
        <div className="mt-3 space-y-3">
          {node.children.map((child) => (
            <NodeContent key={child.id} node={child} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function BillTextViewer({
  document,
  versionLabel,
  sourceUrl,
}: {
  document: BillTextDocument;
  versionLabel?: string;
  sourceUrl?: string;
}) {
  const startExpanded = document.charCount <= COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(startExpanded ? document.nodes.map((node) => node.id) : []),
  );

  const allOpen = expanded.size === document.nodes.length;

  const toc = useMemo(
    () => document.nodes.map((node) => ({ id: node.id, label: [node.enum, node.header].filter(Boolean).join(" ") || "Section" })),
    [document.nodes],
  );

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setExpanded(allOpen ? new Set() : new Set(document.nodes.map((node) => node.id)));
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
      {/* Table of contents */}
      <aside className="space-y-3">
        <div className="flex items-center justify-between">
          {/* Named for the version, not the bill: the panel re-renders when the selector changes. */}
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]">
            Sections in this version
          </p>
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs font-medium text-[var(--accent-2)] hover:text-[#a5adff]"
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
        <nav className="max-h-[70vh] space-y-1 overflow-auto pr-1">
          {toc.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={() => setExpanded((prev) => new Set(prev).add(item.id))}
              className="block truncate rounded-md px-2 py-1.5 text-[13px] text-[var(--muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--ink)]"
            >
              {item.label}
            </a>
          ))}
        </nav>
        {sourceUrl ? (
          <a
            href={sourceUrl}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-2)] hover:text-[#a5adff]"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Official source{versionLabel ? ` · ${versionLabel}` : ""}
          </a>
        ) : null}
      </aside>

      {/* The bill body: top-level sections are collapsible; deep content renders only when open. */}
      <div className="space-y-4">
        {document.nodes.map((node) => {
          const isOpen = expanded.has(node.id);
          const heading = [node.enum, node.header].filter(Boolean).join(" ") || "Section";
          return (
            <section
              key={node.id}
              id={node.id}
              className="scroll-mt-24 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)]"
            >
              <button
                type="button"
                onClick={() => toggle(node.id)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/2"
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                )}
                <span className="font-semibold text-[var(--ink)]">{heading}</span>
              </button>
              {isOpen ? (
                <div className="border-t border-[var(--line)] px-4 py-3.5">
                  {node.text ? (
                    <p className="mb-3 text-[13px] leading-7 text-[var(--muted)]">{node.text}</p>
                  ) : null}
                  <div className="space-y-3">
                    {node.children.map((child) => (
                      <NodeContent key={child.id} node={child} />
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
