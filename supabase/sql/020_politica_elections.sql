-- Federal election candidate tracking (House, Senate, President) from FEC's /candidates/ endpoint.
--
-- One denormalized table, not a separate "elections" parent: an election (office + state +
-- district + cycle) has no metadata worth storing independently of its candidates -- it's a
-- GROUP BY view computed at read time, not a stored entity.
--
-- politician_id links a candidacy to an existing officeholder when the sync's bioguide<->FEC
-- crosswalk (same one lib/server/fec-funding-graph-sync.ts already uses) finds a match. It stays
-- null for challengers, open-seat candidates, and every presidential candidate -- none of those
-- are `politicians` rows, and that's correct, not a gap to backfill.
create table if not exists public.election_candidates (
  id text primary key,               -- `${fec_candidate_id}-${cycle}`
  fec_candidate_id text not null,
  cycle integer not null,
  election_year integer,
  office text not null,              -- 'H' | 'S' | 'P'
  office_full text,
  party text,
  party_full text,
  state text,
  district text,
  incumbent_challenge text,
  incumbent_challenge_full text,
  candidate_status text,
  candidate_inactive boolean,
  active_through integer,
  name text not null,
  politician_id text references public.politicians (id),
  source_system text not null default 'fec',
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb
);

create index if not exists election_candidates_office_cycle_state_idx
  on public.election_candidates (office, cycle, state);
create index if not exists election_candidates_politician_id_idx
  on public.election_candidates (politician_id);
