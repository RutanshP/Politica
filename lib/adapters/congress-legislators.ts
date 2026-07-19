import { load } from "js-yaml";

const COMMITTEE_MEMBERSHIP_URL =
  process.env.POLITICA_CONGRESS_LEGISLATORS_COMMITTEE_MEMBERSHIP_URL?.trim()
  || "https://raw.githubusercontent.com/unitedstates/congress-legislators/main/committee-membership-current.yaml";

const FETCH_TIMEOUT_MS = 20000;

export interface CongressLegislatorsCommitteeMember {
  name?: string;
  party?: string;
  rank?: number;
  title?: string;
  bioguide?: string;
}

type RawCommitteeMembership = Record<string, CongressLegislatorsCommitteeMember[]>;

/**
 * Congress.gov's own API never exposes a committee's member roster -- only a chair/ranking-member
 * name string per committee. The free, static, no-key-required unitedstates/congress-legislators
 * project publishes the real roster, keyed by the same "thomas_id" codes Congress.gov's systemCode
 * is built from: a bare code like "SSAF" is the full committee ("ssaf00"), and a code already
 * suffixed with a subcommittee number like "SSAF13" maps directly ("ssaf13").
 */
export async function fetchCongressLegislatorsCommitteeMembership() {
  const response = await fetch(COMMITTEE_MEMBERSHIP_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`congress-legislators committee membership fetch failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const parsed = (load(text) as RawCommitteeMembership) || {};

  const bySystemCode = new Map<string, CongressLegislatorsCommitteeMember[]>();
  for (const [code, members] of Object.entries(parsed)) {
    if (!Array.isArray(members)) {
      continue;
    }
    const systemCode = /^[A-Za-z]+$/.test(code) ? `${code.toLowerCase()}00` : code.toLowerCase();
    bySystemCode.set(systemCode, members);
  }

  return bySystemCode;
}
