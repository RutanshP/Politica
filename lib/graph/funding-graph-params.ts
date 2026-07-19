import { z } from "zod";

import {
  DEFAULT_FUNDING_GRAPH_FILTERS,
  FUNDING_GRAPH_ENTITY_TYPES,
  FUNDING_GRAPH_EXPANDED_NODE_LIMIT,
  FUNDING_GRAPH_INITIAL_NODE_LIMIT,
  FUNDING_GRAPH_MAX_NODE_LIMIT,
  FUNDING_GRAPH_RELATIONSHIP_TYPES,
  type FundingGraphFilters,
} from "@/types/funding-graph";

const booleanParam = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const csvParam = <T extends readonly [string, ...string[]]>(allowed: T) =>
  z.string().transform((value, ctx) => {
    const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
      if (!(allowed as readonly string[]).includes(part)) {
        ctx.addIssue({ code: "custom", message: `Unknown value: ${part}` });
        return z.NEVER;
      }
    }
    return parts as unknown as Array<T[number]>;
  });

export const fundingGraphQuerySchema = z.object({
  cycle: z.coerce.number().int().min(1990).max(2100).optional(),
  depth: z.coerce.number().int().min(1).max(3).default(DEFAULT_FUNDING_GRAPH_FILTERS.depth),
  minimumAmount: z.coerce.number().min(0).optional(),
  maximumAmount: z.coerce.number().min(0).optional(),
  nodeTypes: csvParam(FUNDING_GRAPH_ENTITY_TYPES).optional(),
  edgeTypes: csvParam(FUNDING_GRAPH_RELATIONSHIP_TYPES).optional(),
  groupSmallDonors: booleanParam.default(true),
  showLegislative: booleanParam.default(true),
  showLobbying: booleanParam.default(true),
  showIndependentExpenditures: booleanParam.default(true),
  limit: z.coerce
    .number()
    .int()
    .min(5)
    .max(FUNDING_GRAPH_MAX_NODE_LIMIT)
    .default(FUNDING_GRAPH_INITIAL_NODE_LIMIT),
});

export function parseFundingGraphQuery(searchParams: URLSearchParams):
  | { ok: true; filters: FundingGraphFilters }
  | { ok: false; error: string } {
  const raw = Object.fromEntries(
    [...searchParams.entries()].filter(([, value]) => value !== ""),
  );
  const parsed = fundingGraphQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  }

  // Beyond the expanded budget, callers must narrow with more filters -- the
  // spec forbids >150 nodes outright and >100 without added constraints.
  const hasNarrowingFilters = Boolean(
    parsed.data.nodeTypes?.length || parsed.data.edgeTypes?.length
    || parsed.data.minimumAmount !== undefined || parsed.data.cycle !== undefined,
  );
  const limit = parsed.data.limit > FUNDING_GRAPH_EXPANDED_NODE_LIMIT && !hasNarrowingFilters
    ? FUNDING_GRAPH_EXPANDED_NODE_LIMIT
    : parsed.data.limit;

  return { ok: true, filters: { ...parsed.data, limit } };
}

/** Inverse of parseFundingGraphQuery: only non-default values are emitted. */
export function serializeFundingGraphFilters(filters: FundingGraphFilters) {
  const params = new URLSearchParams();
  if (filters.cycle !== undefined) params.set("cycle", String(filters.cycle));
  if (filters.depth !== DEFAULT_FUNDING_GRAPH_FILTERS.depth) params.set("depth", String(filters.depth));
  if (filters.minimumAmount !== undefined) params.set("minimumAmount", String(filters.minimumAmount));
  if (filters.maximumAmount !== undefined) params.set("maximumAmount", String(filters.maximumAmount));
  if (filters.nodeTypes?.length) params.set("nodeTypes", filters.nodeTypes.join(","));
  if (filters.edgeTypes?.length) params.set("edgeTypes", filters.edgeTypes.join(","));
  if (!filters.groupSmallDonors) params.set("groupSmallDonors", "false");
  if (!filters.showLegislative) params.set("showLegislative", "false");
  if (!filters.showLobbying) params.set("showLobbying", "false");
  if (!filters.showIndependentExpenditures) params.set("showIndependentExpenditures", "false");
  if (filters.limit !== FUNDING_GRAPH_INITIAL_NODE_LIMIT) params.set("limit", String(filters.limit));
  return params;
}

export const neighborsQuerySchema = z.object({
  exclude: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const edgeRecordsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
