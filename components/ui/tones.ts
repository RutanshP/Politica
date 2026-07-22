import type { BillStatus } from "@/types/civic";

/**
 * One tone vocabulary for the whole app. Every pill, icon tile, and meter picks from this list
 * rather than hardcoding Tailwind color classes, so a palette change happens in one place.
 *
 * `party` tones are reserved strictly for party identity -- never reuse them for pass/fail, or
 * a failed Republican-sponsored bill starts reading as a party statement.
 */
export type Tone =
  | "indigo"
  | "emerald"
  | "sky"
  | "amber"
  | "rose"
  | "slate"
  | "party-d"
  | "party-r"
  | "party-i";

/** Soft-filled pill: tinted background, saturated text. */
export const PILL_TONE: Record<Tone, string> = {
  indigo: "bg-[var(--accent-soft)] text-[var(--accent-2)]",
  emerald: "bg-[var(--success-soft)] text-[var(--success)]",
  sky: "bg-[var(--info-soft)] text-[var(--info)]",
  amber: "bg-[var(--warning-soft)] text-[var(--warning)]",
  rose: "bg-[var(--danger-soft)] text-[var(--danger)]",
  slate: "bg-white/6 text-[var(--muted)]",
  "party-d": "bg-[var(--party-d-soft)] text-[var(--party-d)]",
  "party-r": "bg-[var(--party-r-soft)] text-[var(--party-r)]",
  "party-i": "bg-[var(--party-i-soft)] text-[var(--party-i)]",
};

/** Raw color value, for SVG strokes and inline meter fills. */
export const TONE_COLOR: Record<Tone, string> = {
  indigo: "var(--accent)",
  emerald: "var(--success)",
  sky: "var(--info)",
  amber: "var(--warning)",
  rose: "var(--danger)",
  slate: "var(--faint)",
  "party-d": "var(--party-d)",
  "party-r": "var(--party-r)",
  "party-i": "var(--party-i)",
};

export const BILL_STATUS_TONE: Record<BillStatus, Tone> = {
  Introduced: "slate",
  "In Committee": "amber",
  "On Floor": "sky",
  "Passed Chamber": "emerald",
  "Sent to President": "indigo",
  Signed: "emerald",
  Failed: "rose",
};

/** Accepts "D", "Democratic", "R", "Republican", etc. */
export function partyTone(party?: string | null): Tone {
  const first = (party || "").trim().charAt(0).toUpperCase();
  if (first === "D") return "party-d";
  if (first === "R") return "party-r";
  if (first === "I") return "party-i";
  return "slate";
}
