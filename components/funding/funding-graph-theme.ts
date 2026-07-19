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

export const ENTITY_THEME: Record<FundingGraphEntityType, EntityTheme> = {
  politician: { icon: Landmark, color: "#2563eb", softColor: "#dbeafe", label: "Politician" },
  individualDonor: { icon: User, color: "#0f766e", softColor: "#ccfbf1", label: "Individual donor" },
  donorAggregate: { icon: Users, color: "#0d9488", softColor: "#ccfbf1", label: "Donor group" },
  candidateCommittee: { icon: CircleDollarSign, color: "#4f46e5", softColor: "#e0e7ff", label: "Candidate committee" },
  pac: { icon: HandCoins, color: "#ea580c", softColor: "#ffedd5", label: "PAC" },
  partyCommittee: { icon: Flag, color: "#7c3aed", softColor: "#ede9fe", label: "Party committee" },
  independentExpenditureGroup: { icon: Megaphone, color: "#059669", softColor: "#d1fae5", label: "Outside spending group" },
  employer: { icon: Building2, color: "#0369a1", softColor: "#e0f2fe", label: "Employer group" },
  industry: { icon: Factory, color: "#1d4ed8", softColor: "#dbeafe", label: "Industry" },
  company: { icon: Building, color: "#334155", softColor: "#e2e8f0", label: "Company" },
  union: { icon: Users, color: "#b45309", softColor: "#fef3c7", label: "Union" },
  advocacyGroup: { icon: Megaphone, color: "#be185d", softColor: "#fce7f3", label: "Advocacy group" },
  lobbyingFirm: { icon: Scale, color: "#be123c", softColor: "#ffe4e6", label: "Lobbying firm" },
  committee: { icon: Gavel, color: "#7c3aed", softColor: "#ede9fe", label: "Committee" },
  bill: { icon: FileText, color: "#1d4ed8", softColor: "#dbeafe", label: "Bill" },
  amendment: { icon: Layers, color: "#0891b2", softColor: "#cffafe", label: "Amendment" },
  vote: { icon: Vote, color: "#1f2937", softColor: "#e5e7eb", label: "Vote" },
  issue: { icon: Target, color: "#475569", softColor: "#e2e8f0", label: "Issue" },
  agency: { icon: Banknote, color: "#a16207", softColor: "#fef9c3", label: "Agency" },
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
  if (relationshipType === "independent_spending_support") return { stroke: "#059669" };
  if (relationshipType === "independent_spending_oppose") return { stroke: "#dc2626" };
  if (relationshipType === "retained" || relationshipType === "lobbied_on") {
    return { stroke: "#be123c", dash: "10 5" };
  }
  if (
    relationshipType === "affiliated_with"
    || relationshipType === "employed_by"
    || relationshipType === "member_of"
    || relationshipType === "chairs"
  ) {
    return { stroke: "#94a3b8", dash: "2 5" };
  }
  if (
    relationshipType === "sponsored"
    || relationshipType === "cosponsored"
    || relationshipType === "voted_on"
    || relationshipType === "considered"
    || relationshipType === "classified_under"
    || relationshipType === "affected_by"
  ) {
    return { stroke: "#64748b", dash: "2 5" };
  }
  if (isAggregate) return { stroke: "#0d9488", dash: "7 5" };
  return { stroke: "#475569" };
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
