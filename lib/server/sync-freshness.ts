import { createHash } from "node:crypto";

type FreshnessRow = {
  source_updated_at?: string | null;
  source_fingerprint?: string | null;
};

function sortObject(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(sortObject);
  }

  if (input && typeof input === "object") {
    return Object.keys(input as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = sortObject((input as Record<string, unknown>)[key]);
        return accumulator;
      }, {});
  }

  return input;
}

export function buildSourceFingerprint(input: unknown) {
  return createHash("sha1")
    .update(JSON.stringify(sortObject(input)))
    .digest("hex");
}

export function normalizeSourceUpdatedAt(value?: string | null) {
  const normalized = (value || "").trim();
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }

  return parsed.toISOString();
}

export function classifyFreshness(
  stored: FreshnessRow | undefined,
  nextSourceUpdatedAt?: string | null,
  nextFingerprint?: string | null,
) {
  if (!stored) {
    return "new" as const;
  }

  const storedUpdatedAt = normalizeSourceUpdatedAt(stored.source_updated_at);
  const nextUpdatedAt = normalizeSourceUpdatedAt(nextSourceUpdatedAt);
  const storedFingerprint = stored.source_fingerprint || null;
  const normalizedNextFingerprint = nextFingerprint || null;

  if (nextUpdatedAt && storedUpdatedAt) {
    if (nextUpdatedAt === storedUpdatedAt && storedFingerprint === normalizedNextFingerprint) {
      return "unchanged" as const;
    }

    if (Date.parse(nextUpdatedAt) > Date.parse(storedUpdatedAt)) {
      return "changed" as const;
    }
  }

  if (normalizedNextFingerprint && storedFingerprint === normalizedNextFingerprint) {
    return "unchanged" as const;
  }

  return "changed" as const;
}
