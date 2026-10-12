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
 * Colors are tuned for the paper canvas: hues sit in the 600-800 weight range so they stay
 * legible against --panel as both a node border and small icon, and `softColor` is a pale wash of
 * the same hue for the node fill.
 *
 * There are nineteen entity types and no categorical palette separates nineteen hues, so colors
 * here run in families -- donors teal, committees indigo/violet, outside money orange and red,
 * legislative objects slate -- and every node also carries its own icon and label. Color narrows
 * the guess; the icon settles it.
 */
export const ENTITY_THEME: Record<FundingGraphEntityType, EntityTheme> = {
  politician: { icon: Landmark, color: "#1d4ed8", softColor: "rgba(29,78,216,0.12)", label: "Politician" },
  individualDonor: { icon: User, color: "#0f766e", softColor: "rgba(15,118,110,0.12)", label: "Individual donor" },
  donorAggregate: { icon: Users, color: "#0d9488", softColor: "rgba(13,148,136,0.12)", label: "Donor group" },
  candidateCommittee: { icon: CircleDollarSign, color: "#4338ca", softColor: "rgba(67,56,202,0.12)", label: "Candidate committee" },
  pac: { icon: HandCoins, color: "#c2410c", softColor: "rgba(194,65,12,0.12)", label: "PAC" },
  partyCommittee: { icon: Flag, color: "#6b4ea8", softColor: "rgba(107,78,168,0.12)", label: "Party committee" },
  independentExpenditureGroup: { icon: Megaphone, color: "#047857", softColor: "rgba(4,120,87,0.12)", label: "Outside spending group" },
  employer: { icon: Building2, color: "#0369a1", softColor: "rgba(3,105,161,0.12)", label: "Employer group" },
  industry: { icon: Factory, color: "#4f46e5", softColor: "rgba(79,70,229,0.12)", label: "Industry" },
  company: { icon: Building, color: "#475569", softColor: "rgba(71,85,105,0.12)", label: "Company" },
  union: { icon: Users, color: "#a16207", softColor: "rgba(161,98,7,0.12)", label: "Union" },
  advocacyGroup: { icon: Megaphone, color: "#db2777", softColor: "rgba(219,39,119,0.12)", label: "Advocacy group" },
  lobbyingFirm: { icon: Scale, color: "#be123c", softColor: "rgba(190,18,60,0.12)", label: "Lobbying firm" },
  committee: { icon: Gavel, color: "#9333ea", softColor: "rgba(147,51,234,0.12)", label: "Committee" },
  bill: { icon: FileText, color: "#4338ca", softColor: "rgba(67,56,202,0.12)", label: "Bill" },
  amendment: { icon: Layers, color: "#0e7490", softColor: "rgba(14,116,144,0.12)", label: "Amendment" },
  vote: { icon: Vote, color: "#6366f1", softColor: "rgba(99,102,241,0.12)", label: "Vote" },
  issue: { icon: Target, color: "#64748b", softColor: "rgba(100,116,139,0.12)", label: "Issue" },
  agency: { icon: Banknote, color: "#ca8a04", softColor: "rgba(202,138,4,0.12)", label: "Agency" },
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
 * affiliations. Long-dash pink = lobbying. Legislative edges stay thin slate.
 *
 * Support and oppose are the one pair a reader must never confuse, so they differ in dash
 * pattern as well as hue -- green and red alone is exactly the pair red-green colorblind readers
 * cannot separate.
 */
export function getEdgeTheme(
  relationshipType: FundingGraphRelationshipType,
  isAggregate: boolean,
): EdgeTheme {
  if (relationshipType === "independent_spending_support") return { stroke: "#047857" };
  if (relationshipType === "independent_spending_oppose") return { stroke: "#b91c1c", dash: "6 3" };
  if (relationshipType === "retained" || relationshipType === "lobbied_on") {
    return { stroke: "#be185d", dash: "10 5" };
  }
  if (
    relationshipType === "affiliated_with"
    || relationshipType === "employed_by"
    || relationshipType === "member_of"
    || relationshipType === "chairs"
  ) {
    return { stroke: "#64748b", dash: "2 5" };
  }
  if (
    relationshipType === "sponsored"
    || relationshipType === "cosponsored"
    || relationshipType === "voted_on"
    || relationshipType === "considered"
    || relationshipType === "classified_under"
    || relationshipType === "affected_by"
  ) {
    return { stroke: "#94a3b8", dash: "2 5" };
  }
  if (isAggregate) return { stroke: "#0d9488", dash: "7 5" };
  return { stroke: "#52525b" };
}

export function formatMoney(amount?: number) {
  if (amount === undefined || amount === null) return "";
  if (Math.abs(amount) >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount.toLocaleString()}`;
}

export function formatMoneyExact(amount?: number) {
  if (amount === undefined || amount === null) return "—";
  return `$${amount.toLocaleString()}`;
}

export { TrendingDown, TrendingUp };
