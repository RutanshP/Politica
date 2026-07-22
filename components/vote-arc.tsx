import type { Vote } from "@/types/civic";

const ROWS = 9;
const INNER_RADIUS = 78;
const ROW_GAP = 16;
const DOT_RADIUS = 3;

const SEGMENTS = [
  { key: "yea", label: "Yea", color: "var(--success)" },
  { key: "nay", label: "Nay", color: "var(--danger)" },
  { key: "present", label: "Present", color: "var(--warning)" },
  { key: "notVoting", label: "Not voting", color: "var(--faint)" },
] as const;

/**
 * Allocates `total` seats across the arc's rows in proportion to each row's arc length, then
 * folds the rounding drift into the outer row so the rendered dot count is exactly `total`.
 * Getting this wrong is why chamber diagrams so often show 433 dots for a 435-member vote.
 */
function seatCounts(total: number) {
  const radii = Array.from({ length: ROWS }, (_, row) => INNER_RADIUS + row * ROW_GAP);
  const sum = radii.reduce((acc, radius) => acc + radius, 0);
  const counts = radii.map((radius) => Math.round((total * radius) / sum));
  counts[ROWS - 1] += total - counts.reduce((acc, count) => acc + count, 0);
  return { radii, counts };
}

/**
 * Chamber seating arc: one dot per member, colored by how they voted. Pure SVG so it renders in
 * a server component -- no chart library and no client bundle.
 */
export function VoteArc({ vote }: { vote: Vote }) {
  const tally = {
    yea: vote.yea,
    nay: vote.nay,
    present: vote.present,
    notVoting: vote.notVoting,
  };
  const total = tally.yea + tally.nay + tally.present + tally.notVoting;
  if (total <= 0) return null;

  const { radii, counts } = seatCounts(total);

  // Every seat, ordered left-to-right across the arc so each bloc reads as one contiguous mass.
  const seats: Array<{ x: number; y: number; t: number }> = [];
  const centerX = 0;
  const centerY = 0;

  radii.forEach((radius, row) => {
    const count = counts[row];
    for (let index = 0; index < count; index += 1) {
      const t = count === 1 ? 0.5 : index / (count - 1);
      const angle = Math.PI + t * Math.PI;
      seats.push({
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        t,
      });
    }
  });
  seats.sort((left, right) => left.t - right.t);

  const outer = radii[ROWS - 1] + DOT_RADIUS + 2;
  const width = outer * 2;
  const height = outer;

  // Each bloc's starting offset, derived rather than accumulated through a mutable cursor.
  const blocStart = SEGMENTS.map((_, index) =>
    SEGMENTS.slice(0, index).reduce((sum, segment) => sum + tally[segment.key], 0),
  );

  const colored = SEGMENTS.flatMap((segment, blocIndex) =>
    seats
      .slice(blocStart[blocIndex], blocStart[blocIndex] + tally[segment.key])
      .map((seat, index) => ({
        ...seat,
        color: segment.color,
        key: `${segment.key}-${index}`,
      })),
  );

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="flex flex-none flex-col gap-3.5">
        {SEGMENTS.filter((segment) => tally[segment.key] > 0).map((segment) => (
          <div key={segment.key}>
            <p
              className="num text-[28px] font-semibold leading-none tracking-[-0.02em]"
              style={{ color: segment.color }}
            >
              {tally[segment.key].toLocaleString()}
            </p>
            <p className="mt-1 text-[11.5px] text-[var(--faint)]">{segment.label}</p>
          </div>
        ))}
      </div>

      <div className="relative min-w-[240px] flex-1">
        <svg
          viewBox={`${-outer} ${-outer} ${width} ${height}`}
          className="h-auto w-full"
          role="img"
          aria-label={SEGMENTS.filter((segment) => tally[segment.key] > 0)
            .map((segment) => `${tally[segment.key]} ${segment.label.toLowerCase()}`)
            .join(", ")}
        >
          {colored.map((seat) => (
            <circle key={seat.key} cx={seat.x} cy={seat.y} r={DOT_RADIUS} fill={seat.color} />
          ))}
        </svg>
        <div className="absolute inset-x-0 bottom-0 text-center">
          <p className="num text-2xl font-semibold tracking-[-0.02em]">{total.toLocaleString()}</p>
          <p className="text-[11.5px] text-[var(--faint)]">Total votes</p>
        </div>
      </div>
    </div>
  );
}
