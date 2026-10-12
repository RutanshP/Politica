/**
 * Dollar formatting, shared by every page that shows money.
 *
 * Lived in components/funding/funding-graph-theme.ts until the React Flow funding graph was
 * removed; the rest of that file -- icons and colors for nineteen node types and twenty edge
 * types -- had no importers left, but these two were used in seven places, including a server
 * module that had no business importing from components/.
 */

/** Compact, for tables and labels: $2.9B, $14.2M, $850K, $412. */
export function formatMoney(amount?: number) {
  if (amount === undefined || amount === null) return "";
  if (Math.abs(amount) >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount.toLocaleString()}`;
}

/** Every digit, for a figure a reader might cite or check against a filing. */
export function formatMoneyExact(amount?: number) {
  if (amount === undefined || amount === null) return "—";
  return `$${amount.toLocaleString()}`;
}
