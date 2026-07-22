import {
  Banknote,
  Building,
  Building2,
  CircleDollarSign,
  Factory,
  FileText,
  Flag,
  Gavel,
  HandCoins,
  Landmark,
  Layers,
  Megaphone,
  Scale,
  Target,
  TrendingDown,
  TrendingUp,
  User,
  Users,
  Vote,
} from "lucide-react";
import type { ComponentType, CSSProperties } from "react";

import type { FundingGraphEntityType, FundingGraphRelationshipType } from "@/types/funding-graph";

export interface EntityTheme {
  icon: ComponentType<{ size?: number | string; className?: string; style?: CSSProperties }>;
  color: string;
  softColor: string;
  label: string;
}

/*
 * Colors are tuned for the dark canvas: hues sit in the 300-400 weight range so they stay legible
 * against --panel, and `softColor` is a translucent wash of the same hue rather than a pastel
 * tint (a light pastel fill would read as a glowing blob on a near-black ground).
 */
export const ENTITY_THEME: Record<FundingGraphEntityType, EntityTheme> = {
  politician: { icon: Landmark, color: "#60a5fa", softColor: "rgba(96,165,250,0.16)", label: "Politician" },
  individualDonor: { icon: User, color: "#2dd4bf", softColor: "rgba(45,212,191,0.16)", label: "Individual donor" },
  donorAggregate: { icon: Users, color: "#5eead4", softColor: "rgba(94,234,212,0.16)", label: "Donor group" },
  candidateCommittee: { icon: CircleDollarSign, color: "#818cf8", softColor: "rgba(129,140,248,0.16)", label: "Candidate committee" },
  pac: { icon: HandCoins, color: "#fb923c", softColor: "rgba(251,146,60,0.16)", label: "PAC" },
  partyCommittee: { icon: Flag, color: "#a78bfa", softColor: "rgba(167,139,250,0.16)", label: "Party committee" },
  independentExpenditureGroup: { icon: Megaphone, color: "#34d399", softColor: "rgba(52,211,153,0.16)", label: "Outside spending group" },
  employer: { icon: Building2, color: "#38bdf8", softColor: "rgba(56,189,248,0.16)", label: "Employer group" },
  industry: { icon: Factory, color: "#6366f1", softColor: "rgba(99,102,241,0.16)", label: "Industry" },
  company: { icon: Building, color: "#94a3b8", softColor: "rgba(148,163,184,0.16)", label: "Company" },
  union: { icon: Users, color: "#fbbf24", softColor: "rgba(251,191,36,0.16)", label: "Union" },
  advocacyGroup: { icon: Megaphone, color: "#f472b6", softColor: "rgba(244,114,182,0.16)", label: "Advocacy group" },
  lobbyingFirm: { icon: Scale, color: "#fb7185", softColor: "rgba(251,113,133,0.16)", label: "Lobbying firm" },
  committee: { icon: Gavel, color: "#c084fc", softColor: "rgba(192,132,252,0.16)", label: "Committee" },
  bill: { icon: FileText, color: "#818cf8", softColor: "rgba(129,140,248,0.16)", label: "Bill" },
  amendment: { icon: Layers, color: "#22d3ee", softColor: "rgba(34,211,238,0.16)", label: "Amendment" },
  vote: { icon: Vote, color: "#a5b4fc", softColor: "rgba(165,180,252,0.16)", label: "Vote" },
  issue: { icon: Target, color: "#8b95ad", softColor: "rgba(139,149,173,0.16)", label: "Issue" },
  agency: { icon: Banknote, color: "#facc15", softColor: "rgba(250,204,21,0.16)", label: "Agency" },
};

export function getEntityTheme(entityType: FundingGraphEntityType): EntityTheme {
  return ENTITY_THEME[entityType] || ENTITY_THEME.issue;
}

export interface EdgeTheme {
  stroke: string;
  dash?: string;
  animatedByDefault?: boolean;
}

/**
 * Solid = direct transactions. Dashed = aggregated money. Dotted = structural
 * affiliations. Long-dash rose = lobbying. Legislative edges stay thin slate.
 */
export function getEdgeTheme(
  relationshipType: FundingGraphRelationshipType,
  isAggregate: boolean,
): EdgeTheme {
  if (relationshipType === "independent_spending_support") return { stroke: "#34d399" };
  if (relationshipType === "independent_spending_oppose") return { stroke: "#f87171" };
  if (relationshipType === "retained" || relationshipType === "lobbied_on") {
    return { stroke: "#fb7185", dash: "10 5" };
  }
  if (
    relationshipType === "affiliated_with"
    || relationshipType === "employed_by"
    || relationshipType === "member_of"
    || relationshipType === "chairs"
  ) {
    return { stroke: "#8b95ad", dash: "2 5" };
  }
  if (
    relationshipType === "sponsored"
    || relationshipType === "cosponsored"
    || relationshipType === "voted_on"
    || relationshipType === "considered"
    || relationshipType === "classified_under"
    || relationshipType === "affected_by"
  ) {
    return { stroke: "#6b7690", dash: "2 5" };
  }
  if (isAggregate) return { stroke: "#2dd4bf", dash: "7 5" };
  return { stroke: "#7d8aa5" };
}

export function formatMoney(amount?: number) {
  if (amount === undefined || amount === null) return "";
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount.toLocaleString()}`;
}

export function formatMoneyExact(amount?: number) {
  if (amount === undefined || amount === null) return "—";
  return `$${amount.toLocaleString()}`;
}

export { TrendingDown, TrendingUp };
