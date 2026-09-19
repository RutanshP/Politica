-- Named PAC money per member, for the Congress money network (/money/graph). Already applied.
--
-- The funding graph only knew one "PACs & party committees" figure per member -- FEC candidate
-- totals -- so no two members could be connected through a PAC they share. These tables hold
-- FEC Schedule B aggregates by recipient: each committee that paid a member's principal campaign
-- committee in a cycle, totalled per payer (lib/server/pac-contributions-sync.ts).
--
-- Deliberately narrow rather than rows in graph_edges: ~80k (member, committee) pairs as wide
-- graph_edges rows with text ids and jsonb metadata would cost several times the space against a
-- 500MB database. Measured at 52k pairs: about 11MB including indexes.
--
-- Joint fundraising committees (designation J) are not stored at all; they pass through money
-- individuals already gave. A member's own committees paying their campaign are dropped at sync.

create table if not exists public.pac_committees (
  committee_id text primary key,
  name text not null,
  -- corporate | labor | trade | ideological | super_pac | party | leadership | campaign
  -- (lib/graph/pac-classification.ts)
  category text not null,
  committee_type text,
  designation text,
  organization_type text,
  party text,
  connected_org text,
  -- The member who runs it: a leadership PAC's sponsor, or a campaign's candidate.
  sponsor_politician_id text references public.politicians(id) on delete set null,
  synced_at timestamptz not null default now()
);

create table if not exists public.pac_contributions (
  politician_id text not null references public.politicians(id) on delete cascade,
  cycle smallint not null,
  committee_id text not null references public.pac_committees(committee_id) on delete cascade,
  total numeric(14,2) not null,
  contribution_count integer not null default 0,
  -- Rows a sync run did not rewrite for a member are pruned by this.
  synced_at timestamptz not null default now(),
  primary key (politician_id, cycle, committee_id)
);
create index if not exists pac_contributions_committee_idx on public.pac_contributions (committee_id);

-- Staleness rotation for the sync, and the member's principal committee once resolved.
create table if not exists public.pac_sync_state (
  politician_id text primary key references public.politicians(id) on delete cascade,
  principal_committee_id text,
  cycle smallint,
  committees_found integer not null default 0,
  synced_at timestamptz not null default now()
);

alter table public.pac_committees enable row level security;
alter table public.pac_contributions enable row level security;
alter table public.pac_sync_state enable row level security;
create policy "public read" on public.pac_committees for select using (true);
create policy "public read" on public.pac_contributions for select using (true);
