import { layoutCongressNetwork } from "@/lib/graph/congress-network-layout";
import {
  type CongressNetwork,
  type NetworkCommittee,
  type NetworkMember,
  type NetworkParty,
} from "@/lib/graph/congress-network-wire";
import type { PacCategory } from "@/lib/graph/pac-classification";
import { FUNDING_GRAPH_CACHE_TAG } from "@/lib/supabase/cache-tags";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { fetchSupabaseRows } from "@/lib/supabase/rest";

export * from "@/lib/graph/congress-network-wire";

/*
 * The whole Congress money network in one compact payload: every sitting member, every committee
 * that gave to one of them this cycle, and each (committee, member) total.
 *
 * Shaped for the client graph, not for reading: nodes are arrays of fields and edges are index
 * triples, because ~100k edges as objects with repeated keys would be several megabytes of JSON.
 */

interface ContributionRow {
  politician_id: string;
  committee_id: string;
  total: number | string;
}

interface CommitteeRow {
  committee_id: string;
  name: string;
  category: PacCategory;
  sponsor_politician_id: string | null;
  connected_org: string | null;
}

interface MemberRow {
  id: string;
  slug: string;
  name: string;
  party: string | null;
  state: string | null;
  title: string | null;
  district: string | null;
}

export const NETWORK_CYCLE = 2026;

function partyCode(party: string | null): NetworkParty {
  const value = (party || "").toLowerCase();
  if (value.startsWith("dem")) return "D";
  if (value.startsWith("rep")) return "R";
  return "I";
}

/** Title-cases the all-caps names committees file under, leaving acronyms like PAC alone. */
export function tidyCommitteeName(name: string) {
  if (name !== name.toUpperCase()) return name;
  const keepUpper = new Set(["PAC", "PACS", "USA", "US", "LLC", "LLP", "INC", "II", "III", "AFL-CIO", "NRA", "NEA", "AFT", "SEIU", "UAW", "IBEW", "AT&T", "UPS", "CVS", "BNSF", "COPE"]);
  const keepLower = new Set(["of", "the", "and", "for", "in", "on", "to", "a", "an", "at", "by"]);
  // Short words that are English rather than initials, so anything else of three letters or fewer
  // stays capitalised as the acronym it almost always is ("CWA", "AFT").
  const shortWords = new Set([
    "THE", "AND", "FOR", "NEW", "OUR", "ONE", "TWO", "SIX", "TEN", "WAR", "TAX", "AIR", "OIL", "GAS",
    "CAR", "LAW", "ACT", "AID", "ART", "SEA", "SUN", "RED", "WAY", "YES", "ALL", "OUT", "BIG", "FUN",
    "JOB", "PAY", "RUN", "WIN", "YOU", "HER", "HIS", "NOT", "BUT", "CAN", "MAN", "AGE", "END", "ERA",
    "GUN", "KEY", "NET", "TOP", "USE", "VET", "MY", "WE", "NO", "GO", "UP", "IS", "IT", "BE", "OR", "AS",
  ]);
  return name
    .toLowerCase()
    .split(/(\s+|[/(),-])/)
    .map((word, index) => {
      const upper = word.toUpperCase();
      if (keepUpper.has(upper)) return upper;
      // "BANKPAC", "JSTREETPAC": filed as one loud word, kept that way.
      if (/^[A-Z&]{2,}PAC$/.test(upper)) return upper;
      if (index > 0 && keepLower.has(word)) return word;
      // No vowels ("DCCC", "NRSC") or a short non-word reads as initials.
      if (/^[A-Z&]{2,}$/.test(upper) && (!/[AEIOUY]/.test(upper) || (upper.length <= 3 && !shortWords.has(upper)))) {
        return upper;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join("")
    .replace(/\bPac\b/g, "PAC");
}

export async function getCongressNetwork(cycle = NETWORK_CYCLE): Promise<CongressNetwork | null> {
  if (!isSupabaseConfigured()) return null;

  const read = { tags: [FUNDING_GRAPH_CACHE_TAG], paginateAll: true, pageSize: 1000 };
  const [contributions, committeeRows, memberRows, syncedMembers] = await Promise.all([
    fetchSupabaseRows<ContributionRow>("pac_contributions", `cycle=eq.${cycle}&order=politician_id.asc,committee_id.asc`, {
      ...read,
      paginateTiebreaker: null,
      select: "politician_id,committee_id,total",
    }),
    fetchSupabaseRows<CommitteeRow>("pac_committees", "order=committee_id.asc", {
      ...read,
      paginateTiebreaker: null,
      select: "committee_id,name,category,sponsor_politician_id,connected_org",
    }),
    fetchSupabaseRows<MemberRow>("politicians", "jurisdiction_type=eq.federal&order=id.asc", {
      ...read,
      select: "id,slug,name,party,state,title,district",
    }),
    fetchSupabaseRows<{ politician_id: string }>("pac_sync_state", "order=politician_id.asc", {
      ...read,
      paginateTiebreaker: null,
      select: "politician_id",
    }),
  ]);

  // Every member the PAC sync has covered -- including the few who take no PAC money, who belong
  // in the picture precisely because they stand apart -- plus anyone who runs a committee here.
  const memberIdsInNetwork = new Set([
    ...syncedMembers.map((row) => row.politician_id),
    ...contributions.map((row) => row.politician_id),
  ]);
  for (const committee of committeeRows) {
    if (committee.sponsor_politician_id) memberIdsInNetwork.add(committee.sponsor_politician_id);
  }
  const members: NetworkMember[] = memberRows
    .filter((row) => memberIdsInNetwork.has(row.id))
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      party: partyCode(row.party),
      state: row.state || "",
      chamber: /senat/i.test(row.title || "") ? "Senate" : "House",
      district: row.district,
    }));
  const memberIndex = new Map(members.map((member, index) => [member.id, index]));

  const committeesGiving = new Set(contributions.map((row) => row.committee_id));
  const committees: NetworkCommittee[] = committeeRows
    .filter((row) => committeesGiving.has(row.committee_id))
    .map((row) => ({
      id: row.committee_id,
      name: tidyCommitteeName(row.name),
      category: row.category,
      owner: row.sponsor_politician_id ? memberIndex.get(row.sponsor_politician_id) ?? null : null,
      connectedOrg: row.connected_org ? tidyCommitteeName(row.connected_org) : null,
    }));
  const committeeIndex = new Map(committees.map((committee, index) => [committee.id, index]));

  const edges: number[] = [];
  for (const row of contributions) {
    const from = committeeIndex.get(row.committee_id);
    const to = memberIndex.get(row.politician_id);
    const amount = Math.round(Number(row.total));
    if (from === undefined || to === undefined || !(amount > 0)) continue;
    edges.push(from, to, amount);
  }

  const layout = layoutCongressNetwork({
    memberCount: members.length,
    memberParty: members.map((member) => member.party),
    committeeCount: committees.length,
    edges,
  });

  return {
    cycle,
    members,
    committees,
    edges,
    memberPositions: layout.members,
    committeePositions: layout.committees,
    generatedAt: new Date().toISOString(),
  };
}
