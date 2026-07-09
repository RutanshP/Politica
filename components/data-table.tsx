export function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-[var(--line)]">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--line)] text-sm">
          <thead className="bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-4 py-3">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)] bg-white">
            {rows.map((row, index) => (
              <tr key={index} className="align-top">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-4 py-4 text-[var(--ink)]">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
