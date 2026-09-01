-- Index for the /elections read path. Not yet applied -- run it against the project when
-- convenient; the page works without it, just with a sequential scan.
--
-- The races query is:
--
--   select ... from election_candidates
--   where cycle = 2026 and election_year = 2026
--     and candidate_status = 'C' and candidate_inactive = false
--   order by state, office, district, name
--
-- The existing index is (office, cycle, state), which does not lead with the columns this
-- filters on and cannot serve the ordering. The table is 8,492 rows today, so a scan is cheap;
-- this matters because the filter cuts to 2,460 and the page is rendered on every cold cache.
--
-- Partial, because every row this path will ever want has candidate_status = 'C' and is active.
-- That keeps the index to roughly a third of the table rather than all of it, and lets Postgres
-- drop both predicates from the scan entirely.
create index if not exists politica_election_candidates_live_idx
  on public.election_candidates (cycle, election_year, state, office, district, name)
  where candidate_status = 'C' and candidate_inactive = false;

-- The race detail page looks up finance by politician for one cycle. 538 rows, so this is
-- pre-emptive rather than load-bearing.
create index if not exists politica_candidate_finance_politician_cycle_idx
  on public.candidate_finance_snapshots (politician_id, election_cycle);
