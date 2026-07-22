import { cn } from "@/lib/utils";

export type TableColumn =
  | string
  | {
      label: string;
      align?: "left" | "right" | "center";
      /** Tailwind width class, e.g. "w-24". */
      width?: string;
    };

function normalize(column: TableColumn) {
  return typeof column === "string" ? { label: column, align: "left" as const } : column;
}

const ALIGN = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

/**
 * Dense dark table. Designed to sit flush inside a Card (use `<CardBody flush>`), so the card's
 * border is the table's border -- the old version wrapped itself in a second rounded box, which
 * doubled the frame every time it was nested.
 */
export function Table({
  columns,
  rows,
  emptyMessage = "No results.",
}: {
  columns: TableColumn[];
  rows: React.ReactNode[][];
  emptyMessage?: string;
}) {
  const cols = columns.map(normalize);

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {cols.map((column, index) => (
              <th
                key={`${column.label}-${index}`}
                scope="col"
                className={cn(
                  "whitespace-nowrap border-b border-[var(--line)] bg-[var(--panel-2)] px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]",
                  ALIGN[column.align ?? "left"],
                  column.width,
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={cols.length}
                className="px-3.5 py-10 text-center text-[var(--muted)]"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-b border-[var(--line)] transition last:border-b-0 hover:bg-white/2"
              >
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={cn(
                      "px-3.5 py-3 align-middle text-[var(--ink)]",
                      ALIGN[cols[cellIndex]?.align ?? "left"],
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Primary cell text -- the thing the row is "about". */
export function CellTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn("font-semibold text-[var(--ink)]", className)}>{children}</span>;
}

/** Secondary line inside a cell. */
export function CellSub({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn("text-xs text-[var(--muted)]", className)}>{children}</span>;
}
