-- Authoritative terms of office for sitting members.
--
-- Congress.gov publishes one row per Congress rather than per term, and never states when a term
-- actually ends. That made both facts on the tenure tab guesses: a six-year Senate term arrived as
-- three rows, and the end date had to be projected from the chamber and the start year -- which is
-- wrong for anyone seated mid-cycle to finish someone else's term.
--
-- unitedstates/congress-legislators records terms as terms, with exact start/end dates, the Senate
-- class, and how the seat was filled. It is the same free, keyless dataset already used for the
-- committee rosters and the bioguide<->FEC crosswalk, so this adds a column, not a dependency.
--
-- Sitting members only -- that file covers current legislators. Former members keep deriving their
-- history from raw_member, where the projection is harmless because the service has ended.
alter table if exists public.politicians
  add column if not exists official_terms jsonb;

comment on column public.politicians.official_terms is
  'Terms of office from unitedstates/congress-legislators: [{chamber,start,end,state,district,senateClass,how}]. Authoritative over the per-Congress rows in raw_member.';
