import Link from "next/link";

import { formatMoney } from "@/lib/format-money";
import { EmptyState } from "@/components/empty-state";
import { Card, CardHeader } from "@/components/ui/card";
import type { MoneyFlow } from "@/lib/graph/build-money-flow";
import { stackBand, type MoneyFlowSourceKind } from "@/lib/graph/money-flow-model";

/*
 * The member money-flow diagram: who paid, the member, and the bills they sponsored that someone
 * lobbied on.
 *
 * Drawn as one server-rendered SVG with positions computed up front rather than by a layout
 * engine in the browser -- the bands are fixed, so there is nothing to simulate, and it means the
 * diagram is in the HTML for a reader with no JavaScript. Below `md` the SVG is hidden and the
 * same data reads as three stacked lists, because ribbons across a 390px screen are unreadable.
 *
 * The left and right bands come from different filings and are never joined by a line. Money ran
 * to the member; lobbying ran to the bill. The only place the two are put together is the
 * "both sides" list underneath, which says what it is.
 */

const WIDTH = 940;
const HEIGHT = 420;
const BAND_W = 300;
const NODE_W = 150;
const CENTER_X = WIDTH / 2;
const GAP = 7;
const MIN_ROW = 15;

const KIND_COLOR: Record<MoneyFlowSourceKind, string> = {
  individuals: "#0f766e",
  employer: "#0369a1",
  pac: "#c2410c",
  party: "#6b4ea8",
  outside: "#be123c",
  self: "#475569",
};

/** A ribbon from a source row into the member node: left edge keeps the row's height, right edge pinches. */
function ribbon(y: number, height: number, toY: number, toHeight: number) {
  const x1 = BAND_W;
  const x2 = CENTER_X - NODE_W / 2;
  const mid = (x1 + x2) / 2;
  return [
    `M ${x1} ${y}`,
    `C ${mid} ${y}, ${mid} ${toY}, ${x2} ${toY}`,
    `L ${x2} ${toY + toHeight}`,
    `C ${mid} ${toY + toHeight}, ${mid} ${y + height}, ${x1} ${y + height}`,
    "Z",
  ].join(" ");
}

function Legend() {
  const entries: [MoneyFlowSourceKind, string][] = [
    ["individuals", "Individual donors"],
    ["employer", "Employees of an organization"],
    ["pac", "PACs and unions"],
    ["party", "Party committees"],
    ["outside", "Outside spending"],
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-[var(--muted)]">
      {entries.map(([kind, label]) => (
        <li key={kind} className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: KIND_COLOR[kind] }} />
          {label}
        </li>
      ))}
    </ul>
  );
}

export function MoneyFlowDiagram({ flow }: { flow: MoneyFlow }) {
  const { sources, remainder, bills, bothSides, politician } = flow;

  if (sources.length === 0) {
    return (
      <EmptyState
        title="No itemized money yet"
        description={`Nothing is filed against ${politician.name} for ${flow.cycleLabel.toLowerCase()} that can be traced to a named source. Totals above come from the summary filing.`}
      />
    );
  }

  const rows = remainder.count > 0
    ? [...sources, {
      id: "__remainder__",
      label: `${remainder.count} smaller sources`,
      kind: "self" as MoneyFlowSourceKind,
      amount: remainder.amount,
      isAggregate: true,
      isOpposition: false,
      orgKey: "",
    }]
    : sources;

  const leftBoxes = stackBand(rows.map((row) => row.amount), { height: HEIGHT, gap: GAP, minHeight: MIN_ROW });
  const billBoxes = stackBand(bills.map(() => 1), { height: HEIGHT, gap: 10, minHeight: 30 });

  const incoming = rows.filter((row) => !row.isOpposition);
  const incomingTotal = incoming.reduce((sum, row) => sum + row.amount, 0);
  // The member node is as tall as the money that reached them, so opposition ribbons visibly miss it.
  const nodeHeight = Math.min(HEIGHT, Math.max(120, HEIGHT * 0.62));
  const nodeY = (HEIGHT - nodeHeight) / 2;

  // Where each ribbon lands on the member node: stacked in row order so ribbons never cross.
  const targets = rows.reduce<{ boxes: ({ y: number; height: number } | null)[]; consumed: number }>(
    (state, row) => {
      if (row.isOpposition || incomingTotal <= 0) {
        return { boxes: [...state.boxes, null], consumed: state.consumed };
      }
      const share = (row.amount / incomingTotal) * nodeHeight;
      return {
        boxes: [...state.boxes, { y: nodeY + state.consumed, height: share }],
        consumed: state.consumed + share,
      };
    },
    { boxes: [], consumed: 0 },
  ).boxes;

  return (
    <Card>
      <CardHeader title="Where the money came from" count={flow.cycleLabel} />
      <div className="space-y-4 p-4">
        <Legend />

        {/* Desktop: the diagram. */}
        <div className="hidden md:block">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-auto w-full"
            role="img"
            aria-label={`Money flow for ${politician.name}: ${rows.length} funding sources, and ${bills.length} sponsored bills that organizations lobbied on.`}
          >
            {rows.map((row, index) => {
              const box = leftBoxes[index];
              const target = targets[index];
              const color = KIND_COLOR[row.kind];
              return (
                <g key={row.id}>
                  {target ? (
                    <path d={ribbon(box.y, box.height, target.y, target.height)} fill={color} fillOpacity={0.16} />
                  ) : null}
                  <rect x={BAND_W - 5} y={box.y} width={5} height={box.height} fill={color} rx={1} />
                  <text
                    x={BAND_W - 12}
                    y={box.y + box.height / 2}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fontSize={12}
                    fill="var(--ink)"
                  >
                    <tspan>{row.label.length > 34 ? `${row.label.slice(0, 33)}…` : row.label}</tspan>
                    <tspan dx={8} fill="var(--muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {formatMoney(row.amount)}
                      {row.isOpposition ? " against" : ""}
                    </tspan>
                  </text>
                </g>
              );
            })}

            <rect
              x={CENTER_X - NODE_W / 2}
              y={nodeY}
              width={NODE_W}
              height={nodeHeight}
              rx={10}
              fill="var(--panel-2)"
              stroke="var(--line-2)"
            />
            <text x={CENTER_X} y={nodeY + nodeHeight / 2 - 8} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--ink)">
              {politician.name}
            </text>
            <text x={CENTER_X} y={nodeY + nodeHeight / 2 + 12} textAnchor="middle" fontSize={11} fill="var(--muted)">
              {formatMoney(flow.totals.totalReceipts)} raised
            </text>

            {bills.map((bill, index) => {
              const box = billBoxes[index];
              return (
                <g key={bill.billId}>
                  <rect x={WIDTH - BAND_W} y={box.y} width={4} height={box.height} fill="var(--line-2)" rx={1} />
                  <text x={WIDTH - BAND_W + 12} y={box.y + 13} fontSize={12} fontWeight={600} fill="var(--accent-2)">
                    {bill.number}
                  </text>
                  <text x={WIDTH - BAND_W + 12} y={box.y + 28} fontSize={11} fill="var(--muted)">
                    {bill.clients.toLocaleString()} organizations lobbied
                  </text>
                </g>
              );
            })}
          </svg>
          <p className="mt-1 flex justify-between text-[11px] text-[var(--faint)]">
            <span>Money in — FEC filings</span>
            <span>Bills they sponsored that were lobbied — LDA filings</span>
          </p>
        </div>

        {/* Phone: the same thing as lists. */}
        <div className="space-y-4 md:hidden">
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">Money in</h3>
            <ul className="space-y-1.5">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center gap-2.5 text-[13px]">
                  <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: KIND_COLOR[row.kind] }} />
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  <span className="num flex-none text-[var(--muted)]">
                    {formatMoney(row.amount)}
                    {row.isOpposition ? " against" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          {bills.length > 0 ? (
            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">
                Sponsored bills that were lobbied
              </h3>
              <ul className="space-y-1.5">
                {bills.map((bill) => (
                  <li key={bill.billId} className="flex items-center gap-2.5 text-[13px]">
                    <Link href={bill.href} className="flex-none font-semibold text-[var(--accent-2)]">
                      {bill.number}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-[var(--muted)]">{bill.title}</span>
                    <span className="num flex-none text-[var(--muted)]">{bill.clients.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {bothSides.length > 0 ? (
          <section className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-3.5">
            <h3 className="text-[13px] font-semibold">On both sides</h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              These organizations appear in two different filings: money to {politician.name} reported to the FEC, and a
              Lobbying Disclosure Act report naming a bill {politician.name.split(" ").slice(-1)[0]} sponsored. The filings
              say the two things happened. Neither says one caused the other.
            </p>
            <ul className="mt-2.5 space-y-1.5">
              {bothSides.map((entry) => (
                <li key={entry.orgKey} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
                  <span className="font-medium">{entry.name}</span>
                  <span className="num text-[var(--muted)]">{formatMoney(entry.amount)}</span>
                  <span className="text-[var(--faint)]">· lobbied</span>
                  {entry.bills.map((bill) => (
                    <Link key={bill.billId} href={bill.href} className="font-medium text-[var(--accent-2)]">
                      {bill.number}
                    </Link>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {flow.lobbyingUnavailable ? (
          <p className="text-xs text-[var(--warning)]">
            Lobbying reports could not be read just now, so the bills band is empty. The money side is unaffected.
          </p>
        ) : null}

        <p className="text-[11px] leading-relaxed text-[var(--faint)]">
          Employer rows are itemized individual contributions grouped by the employer each contributor reported — not a
          gift from the organization itself. Outside spending is money spent independently, for or against, and never
          reaches the campaign.
        </p>
      </div>
    </Card>
  );
}
