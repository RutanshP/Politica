import {
  Banknote,
  Building2,
  FileText,
  Gavel,
  GraduationCap,
  HeartPulse,
  Landmark,
  Leaf,
  Scale,
  Shield,
  Tractor,
  Truck,
  Zap,
} from "lucide-react";

import type { Tone } from "@/components/ui/tones";

type TopicVisual = { Icon: React.ComponentType<{ className?: string }>; tone: Tone };

/**
 * Topic strings come from Congress.gov policy areas and vary in wording, so this matches on
 * keywords rather than exact values. Keeps a bill's icon and color stable everywhere it appears
 * -- list row, table cell, hero -- which is what makes the directory scannable.
 */
const RULES: Array<{ match: RegExp; visual: TopicVisual }> = [
  { match: /agricultur|farm|food|rural/i, visual: { Icon: Tractor, tone: "emerald" } },
  { match: /energy|climate|environment|water|conservation/i, visual: { Icon: Leaf, tone: "emerald" } },
  { match: /health|medic|drug|mental/i, visual: { Icon: HeartPulse, tone: "rose" } },
  { match: /defen[cs]e|armed|military|veteran|security|intelligence/i, visual: { Icon: Shield, tone: "sky" } },
  { match: /educat|school|student|labor|workforce/i, visual: { Icon: GraduationCap, tone: "amber" } },
  { match: /transport|infrastructure|public works|housing/i, visual: { Icon: Truck, tone: "indigo" } },
  { match: /tax|budget|finance|appropriat|econom|commerce|trade/i, visual: { Icon: Banknote, tone: "amber" } },
  { match: /judicia|crime|justice|civil right|immigration/i, visual: { Icon: Gavel, tone: "indigo" } },
  { match: /science|technolog|communicat/i, visual: { Icon: Zap, tone: "sky" } },
  { match: /government|administrat|oversight|rules/i, visual: { Icon: Landmark, tone: "slate" } },
  { match: /law|legal|statut/i, visual: { Icon: Scale, tone: "indigo" } },
  { match: /committee|caucus/i, visual: { Icon: Building2, tone: "sky" } },
];

const FALLBACK: TopicVisual = { Icon: FileText, tone: "indigo" };

export function topicVisual(topic?: string | null): TopicVisual {
  if (!topic) return FALLBACK;
  return RULES.find((rule) => rule.match.test(topic))?.visual ?? FALLBACK;
}

/** Renders just the glyph; wrap in IconTile for the tinted square. */
export function TopicIcon({ topic, className }: { topic?: string | null; className?: string }) {
  const { Icon } = topicVisual(topic);
  return <Icon className={className} />;
}
