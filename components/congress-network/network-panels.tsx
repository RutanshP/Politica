"use client";

import { ArrowUpRight, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import type { CongressNetwork, NetworkChamber, NetworkParty } from "@/lib/graph/congress-network-wire";
import { PAC_CATEGORY_LABEL, type PacCategory } from "@/lib/graph/pac-classification";
import { cn } from "@/lib/utils";

import {
  CATEGORY_COLOR,
  CATEGORY_ORDER,
  PARTY_COLOR,
  PARTY_LABEL,
  categorySplit,
  connectionsOf,
  formatDollars,
  membersSharingDonors,
  partySplit,
  type NetworkFilters,
  type NetworkGraph,
  type Visibility,
} from "./network-model";

const panel = "pointer-events-auto rounded-[var(--r-md)] border border-[var(--line-2)] bg-[rgba(13,18,30,0.94)] shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-md";

function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block h-2.5 w-2.5 flex-none rounded-full", className)} style={{ background: color }} />;
}

function Chip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition",
        active
          ? "border-[var(--line-2)] bg-[var(--panel-3)] text-[var(--ink)]"
          : "border-transparent bg-transparent text-[var(--faint)] line-through decoration-[var(--faint)]/60 hover:text-[var(--muted)]",
      )}
    >
      {children}
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--faint)]">{children}</p>;
}

// ---- search --------------------------------------------------------------------------------

export function NetworkSearch({ graph, onSelect }: { graph: NetworkGraph; onSelect: (key: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const index = useMemo(() => {
    const rows: Array<{ key: string; label: string; lower: string; member: boolean; total: number; color: string }> = [];
    graph.forEachNode((key, attributes) => {
      rows.push({
        key,
        label: attributes.name,
        lower: attributes.name.toLowerCase(),
        member: attributes.kind === "member",
        total: attributes.total,
        color: attributes.color,
      });
    });
    return rows;
  }, [graph]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return index
      .filter((row) => row.lower.includes(needle))
      // Members first, then prefix matches, then by money.
      .sort((left, right) =>
        Number(right.member) - Number(left.member)
        || Number(right.lower.startsWith(needle)) - Number(left.lower.startsWith(needle))
        || right.total - left.total)
      .slice(0, 8);
  }, [index, query]);

  const choose = (key: string) => {
    onSelect(key);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className={cn(panel, "relative")}>
      <div className="flex items-center gap-2 px-3">
        <Search className="h-4 w-4 flex-none text-[var(--faint)]" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) choose(results[0].key);
            if (event.key === "Escape") setQuery("");
          }}
          placeholder="Find a member or PAC…"
          aria-label="Find a member or PAC"
          className="h-10 w-full bg-transparent text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--faint)]"
        />
      </div>
      {open && results.length > 0 ? (
        <ul className="border-t border-[var(--line)] py-1">
          {results.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(row.key)}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-[var(--ink)] hover:bg-[var(--panel-3)]"
              >
                <Dot color={row.color} className={row.member ? "h-3 w-3" : "h-2 w-2"} />
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                <span className="num text-[11px] text-[var(--faint)]">{formatDollars(row.total)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---- filters + legend ----------------------------------------------------------------------

const SHORT_CATEGORY_LABEL: Record<PacCategory, string> = {
  corporate: "Corporate",
  trade: "Trade groups",
  labor: "Labor",
  ideological: "Ideological",
  leadership: "Leadership PACs",
  party: "Party",
  super_pac: "Super PACs",
  campaign: "Campaigns",
};

const MIN_AMOUNTS = [
  { label: "Any", value: 0 },
  { label: "$1K+", value: 1_000 },
  { label: "$5K+", value: 5_000 },
  { label: "$10K+", value: 10_000 },
];

export function FilterPanel({
  graph,
  network,
  visibility,
  filters,
  onChange,
  onToggleCategory,
  onReset,
  defaultCollapsed = false,
}: {
  graph: NetworkGraph;
  network: CongressNetwork;
  visibility: Visibility;
  filters: NetworkFilters;
  defaultCollapsed?: boolean;
  onChange: (filters: NetworkFilters) => void;
  onToggleCategory: (category: PacCategory) => void;
  onReset: () => void;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const stats = useMemo(() => {
    let members = 0;
    let committees = 0;
    let gifts = 0;
    let dollars = 0;
    for (const key of visibility.nodes) {
      if (graph.getNodeAttribute(key, "kind") === "member") members += 1;
      else committees += 1;
    }
    for (const edge of visibility.edges) {
      const attributes = graph.getEdgeAttributes(edge);
      if (attributes.kind === "gift") {
        gifts += 1;
        dollars += attributes.amount;
      }
    }
    return { members, committees, gifts, dollars };
  }, [graph, visibility]);

  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value) && next.size > 1) next.delete(value);
    else next.add(value);
    return next;
  };

  const filtered = filters.parties.size < 3 || filters.chambers.size < 2 || filters.categories.size < CATEGORY_ORDER.length || filters.minAmount > 0;

  return (
    <div className={cn(panel, "min-h-0 overflow-y-auto p-3.5")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold text-[var(--ink)]">PAC money in Congress</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--muted)]">
            {stats.members.toLocaleString()} members · {stats.committees.toLocaleString()} committees ·{" "}
            {stats.gifts.toLocaleString()} gifts · {formatDollars(stats.dollars)} · {network.cycle - 1}–{String(network.cycle).slice(2)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex-none rounded-[var(--r-sm)] px-1.5 py-0.5 text-[11px] text-[var(--faint)] hover:text-[var(--ink)]"
        >
          {collapsed ? "Filters" : "Hide"}
        </button>
      </div>

      {collapsed ? null : (
        <div className="mt-3 space-y-3.5">
          <div>
            <SectionLabel>Members</SectionLabel>
            <div className="flex flex-wrap gap-1">
              {(["D", "R", "I"] as NetworkParty[]).map((party) => (
                <Chip key={party} active={filters.parties.has(party)} onClick={() => onChange({ ...filters, parties: toggle(filters.parties, party) })}>
                  <Dot color={PARTY_COLOR[party]} className="h-3 w-3" /> {PARTY_LABEL[party]}s
                </Chip>
              ))}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {(["House", "Senate"] as NetworkChamber[]).map((chamber) => (
                <Chip key={chamber} active={filters.chambers.has(chamber)} onClick={() => onChange({ ...filters, chambers: toggle(filters.chambers, chamber) })}>
                  {chamber}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Committees that gave</SectionLabel>
            <div className="grid grid-cols-2 gap-1">
              {CATEGORY_ORDER.map((category) => (
                <Chip key={category} active={filters.categories.has(category)} onClick={() => onToggleCategory(category)}>
                  <Dot color={CATEGORY_COLOR[category]} className="h-2 w-2" /> <span className="truncate">{SHORT_CATEGORY_LABEL[category]}</span>
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Smallest gift shown</SectionLabel>
            <div className="grid grid-cols-4 gap-1 rounded-[var(--r-sm)] bg-[var(--panel-2)] p-0.5">
              {MIN_AMOUNTS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filters.minAmount === option.value}
                  onClick={() => onChange({ ...filters, minAmount: option.value })}
                  className={cn(
                    "rounded-[6px] py-1 text-[11.5px] font-medium transition",
                    filters.minAmount === option.value ? "bg-[var(--panel-3)] text-[var(--ink)]" : "text-[var(--faint)] hover:text-[var(--muted)]",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-[var(--line)] pt-2.5 text-[11px] text-[var(--faint)]">
            <span>Big dots are members; small ones are the committees that paid them.</span>
            {filtered ? (
              <button type="button" onClick={onReset} className="ml-2 flex-none text-[var(--accent-2)] hover:underline">
                Reset
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- focus details -------------------------------------------------------------------------

function StackedBar({ parts }: { parts: Array<{ key: string; amount: number; color: string; label: string }> }) {
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  if (total <= 0) return null;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-[var(--panel-3)]">
        {parts.map((part) => (
          <span key={part.key} title={`${part.label}: ${formatDollars(part.amount)}`} style={{ width: `${(part.amount / total) * 100}%`, background: part.color }} />
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {parts.map((part) => (
          <div key={part.key} className="flex items-center gap-1.5 text-[11.5px] text-[var(--muted)]">
            <Dot color={part.color} className="h-2 w-2" />
            <span className="min-w-0 flex-1 truncate">{part.label}</span>
            <span className="num text-[var(--ink)]">{Math.round((part.amount / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConnectionList({
  rows,
  onFocus,
  initial = 10,
  valueOf,
}: {
  rows: Array<{ key: string; label: string; color: string; detail?: string }>;
  onFocus: (key: string) => void;
  initial?: number;
  valueOf: (index: number) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, initial);
  return (
    <div>
      <ul className="-mx-1.5">
        {shown.map((row, index) => (
          <li key={row.key}>
            <button
              type="button"
              onClick={() => onFocus(row.key)}
              className="flex w-full items-center gap-2 rounded-[var(--r-sm)] px-1.5 py-1 text-left text-[12.5px] text-[var(--ink)] transition hover:bg-[var(--panel-3)]"
            >
              <Dot color={row.color} className="h-2 w-2" />
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              {row.detail ? <span className="hidden flex-none text-[10.5px] text-[var(--faint)] sm:inline">{row.detail}</span> : null}
              <span className="num w-14 flex-none text-right text-[12px] text-[var(--muted)]">{valueOf(index)}</span>
            </button>
          </li>
        ))}
      </ul>
      {rows.length > initial ? (
        <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-1 text-[11.5px] text-[var(--accent-2)] hover:underline">
          {expanded ? "Show fewer" : `Show all ${rows.length.toLocaleString()}`}
        </button>
      ) : null}
    </div>
  );
}

export function FocusPanel({
  graph,
  network,
  node,
  visibility,
  onFocus,
  onClose,
}: {
  graph: NetworkGraph;
  network: CongressNetwork;
  node: string;
  visibility: Visibility;
  onFocus: (key: string) => void;
  onClose: () => void;
}) {
  const attributes = graph.getNodeAttributes(node);
  const connections = useMemo(() => connectionsOf(graph, node, visibility), [graph, node, visibility]);
  const total = connections.reduce((sum, row) => sum + row.amount, 0);

  return (
    <aside className={cn(panel, "flex h-full max-h-full flex-col overflow-hidden")} aria-label="Selection details">
      <div className="flex items-start gap-3 border-b border-[var(--line)] p-4">
        {attributes.kind === "member" ? (
          <Avatar name={attributes.name} id={network.members[attributes.index].id} party={PARTY_LABEL[attributes.party]} size="lg" />
        ) : (
          <span className="mt-1 grid h-11 w-11 flex-none place-items-center rounded-full" style={{ background: `${attributes.color}22`, border: `1px solid ${attributes.color}66` }}>
            <Dot color={attributes.color} className="h-3.5 w-3.5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug text-[var(--ink)]">{attributes.name}</p>
          {attributes.kind === "member" ? (
            <p className="mt-0.5 text-[12px] text-[var(--muted)]">
              {PARTY_LABEL[attributes.party]} · {network.members[attributes.index].state}
              {attributes.chamber === "House" && network.members[attributes.index].district ? `-${network.members[attributes.index].district}` : ""} ·{" "}
              {attributes.chamber === "Senate" ? "Senator" : "Representative"}
            </p>
          ) : (
            <p className="mt-0.5 text-[12px]" style={{ color: attributes.color }}>
              {PAC_CATEGORY_LABEL[attributes.category]}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Clear selection" className="flex-none rounded-[var(--r-sm)] p-1 text-[var(--faint)] hover:text-[var(--ink)]">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {attributes.kind === "member" ? (
          <MemberDetails graph={graph} network={network} node={node} visibility={visibility} total={total} connections={connections} onFocus={onFocus} />
        ) : (
          <CommitteeDetails graph={graph} network={network} node={node} visibility={visibility} total={total} connections={connections} onFocus={onFocus} />
        )}
      </div>
    </aside>
  );
}

type DetailProps = {
  graph: NetworkGraph;
  network: CongressNetwork;
  node: string;
  visibility: Visibility;
  total: number;
  connections: ReturnType<typeof connectionsOf>;
  onFocus: (key: string) => void;
};

function Headline({ value, caption }: { value: string; caption: string }) {
  return (
    <div>
      <p className="num text-[26px] font-semibold tracking-[-0.02em] text-[var(--ink)]">{value}</p>
      <p className="text-[12px] text-[var(--muted)]">{caption}</p>
    </div>
  );
}

function MemberDetails({ graph, network, node, visibility, total, connections, onFocus }: DetailProps) {
  const attributes = graph.getNodeAttributes(node);
  const member = attributes.kind === "member" ? network.members[attributes.index] : null;
  const categories = useMemo(() => categorySplit(graph, node, visibility), [graph, node, visibility]);
  const similar = useMemo(() => membersSharingDonors(graph, node, visibility), [graph, node, visibility]);
  const owned = useMemo(() => {
    const rows: string[] = [];
    graph.forEachNeighbor(node, (neighbor, neighborAttributes) => {
      if (neighborAttributes.kind === "committee" && neighborAttributes.owner === node) rows.push(neighbor);
    });
    return rows;
  }, [graph, node]);

  return (
    <>
      <Headline value={formatDollars(total)} caption={`from ${connections.length.toLocaleString()} committees this cycle`} />

      {categories.length > 0 ? (
        <div>
          <SectionLabel>Where it came from</SectionLabel>
          <StackedBar parts={categories.map((row) => ({ key: row.category, amount: row.amount, color: CATEGORY_COLOR[row.category], label: PAC_CATEGORY_LABEL[row.category] }))} />
        </div>
      ) : null}

      {owned.length > 0 ? (
        <div>
          <SectionLabel>Runs</SectionLabel>
          <ConnectionList
            rows={owned.map((key) => ({ key, label: graph.getNodeAttribute(key, "name"), color: graph.getNodeAttribute(key, "color") }))}
            valueOf={(index) => formatDollars(graph.getNodeAttribute(owned[index], "total"))}
            onFocus={onFocus}
          />
          <p className="mt-1 text-[11px] text-[var(--faint)]">Amount is what it gave other members.</p>
        </div>
      ) : null}

      {similar.length > 0 ? (
        <div>
          <SectionLabel>Shares the most donors with <span className="normal-case tracking-normal text-[var(--faint)]">· top 6 lit on the map</span></SectionLabel>
          <ConnectionList
            rows={similar}
            valueOf={(index) => `${similar[index].shared} PACs`}
            onFocus={onFocus}
            initial={6}
          />
        </div>
      ) : null}

      <div>
        <SectionLabel>Largest committee gifts</SectionLabel>
        {connections.length > 0 ? (
          <ConnectionList
            rows={connections.map((row) => ({ ...row, detail: undefined }))}
            valueOf={(index) => formatDollars(connections[index].amount)}
            onFocus={onFocus}
          />
        ) : (
          <p className="text-[12px] text-[var(--muted)]">No committee gifts match the current filters.</p>
        )}
      </div>

      {member ? (
        <Link href={`/politicians/${member.slug}/funding`} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--accent-2)] hover:underline">
          Full funding profile <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </>
  );
}

function CommitteeDetails({ graph, network, node, visibility, total, connections, onFocus }: DetailProps) {
  const attributes = graph.getNodeAttributes(node);
  const committee = attributes.kind === "committee" ? network.committees[attributes.index] : null;
  const split = useMemo(() => partySplit(graph, node, visibility), [graph, node, visibility]);
  const owner = attributes.kind === "committee" && attributes.owner ? attributes.owner : null;

  return (
    <>
      <Headline value={formatDollars(total)} caption={`to ${connections.length.toLocaleString()} members this cycle`} />

      {owner ? (
        <div>
          <SectionLabel>{attributes.kind === "committee" && attributes.category === "campaign" ? "Campaign of" : "Run by"}</SectionLabel>
          <ConnectionList
            rows={[{ key: owner, label: graph.getNodeAttribute(owner, "name"), color: graph.getNodeAttribute(owner, "color") }]}
            valueOf={() => ""}
            onFocus={onFocus}
          />
        </div>
      ) : committee?.connectedOrg ? (
        <p className="text-[12px] text-[var(--muted)]">
          Connected to <span className="text-[var(--ink)]">{committee.connectedOrg}</span>
        </p>
      ) : null}

      <div>
        <SectionLabel>Which party it funds</SectionLabel>
        <StackedBar
          parts={(["D", "R", "I"] as NetworkParty[])
            .filter((party) => split[party] > 0)
            .map((party) => ({ key: party, amount: split[party], color: PARTY_COLOR[party], label: `${PARTY_LABEL[party]}s` }))}
        />
      </div>

      <div>
        <SectionLabel>Members it gave to</SectionLabel>
        {connections.length > 0 ? (
          <ConnectionList
            rows={connections}
            valueOf={(index) => formatDollars(connections[index].amount)}
            onFocus={onFocus}
          />
        ) : (
          <p className="text-[12px] text-[var(--muted)]">No gifts match the current filters.</p>
        )}
      </div>

      {committee ? (
        <a
          href={`https://www.fec.gov/data/committee/${committee.id}/`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--accent-2)] hover:underline"
        >
          FEC filings <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </>
  );
}
