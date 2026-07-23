import { Landmark } from "lucide-react";

import { TopicIcon } from "@/components/ui/topic-icon";

const CHAMBER_RING: Record<string, string> = {
  House: "rgba(96,165,250,0.5)",
  Senate: "rgba(52,211,153,0.5)",
  Joint: "rgba(167,139,250,0.5)",
};

/**
 * Committee medallion. Congress.gov ships no per-committee seal, so this is a designed emblem
 * rather than an official seal: a chamber-tinted ring around the committee's sector icon, with a
 * Capitol mark. Swap in real seal artwork here if a licensed source is added.
 */
export function CommitteeSeal({
  chamber,
  sector,
  className,
}: {
  chamber: string;
  sector: string;
  className?: string;
}) {
  const ring = CHAMBER_RING[chamber] ?? "rgba(255,255,255,0.18)";

  return (
    <span
      className={className}
      style={{
        display: "grid",
        placeItems: "center",
        position: "relative",
        height: "76px",
        width: "76px",
        flex: "none",
        borderRadius: "9999px",
        border: `2px solid ${ring}`,
        background:
          "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.06), rgba(255,255,255,0) 60%), var(--panel-2)",
        boxShadow: "inset 0 0 0 4px rgba(255,255,255,0.03)",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: "7px",
          color: "var(--faint)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <Landmark style={{ height: "13px", width: "13px" }} />
      </span>
      <span className="[&>svg]:h-6 [&>svg]:w-6" style={{ marginTop: "8px", color: "var(--ink)" }}>
        <TopicIcon topic={sector} />
      </span>
    </span>
  );
}
