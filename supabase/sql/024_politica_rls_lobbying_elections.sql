-- Enables row level security on the two tables that never got it. Already applied to the project
-- (migration 20260802_enable_rls_lobbying_filings_election_candidates) -- kept here as the record.
--
-- Supabase's linter reported both at ERROR / rls_disabled_in_public: `public.lobbying_filings` and
-- `public.election_candidates` were exposed through PostgREST with RLS off, so anyone holding the
-- publishable (anon) key could not only read them but INSERT, UPDATE and DELETE at will. 125,037
-- filings and 8,244 candidate rows.
--
-- Not a regression -- a gap. The one-time enable_rls_public_read_policies migration
-- (20260719075142) covered the 26 tables that existed then. lobbying_filings was created three days
-- later by 017, and election_candidates later still by 020, so neither was in scope and nothing
-- since re-ran the sweep. Any table added from here needs these two statements.
--
-- The policy is the same one every other table carries: read to anon/authenticated, nothing else.
-- Writes are not granted to anybody -- the syncs authenticate with the secret key, and service_role
-- bypasses RLS entirely, so the write path is unaffected. Worth being explicit that this is the
-- reason it is safe: lib/supabase/rest.ts builds every request -- read and write alike -- from
-- getSupabaseSecretKey(), server-side. getSupabasePublishableKey() is exported but has no caller
-- anywhere in the app, so no application traffic goes through the anon role at all. These policies
-- govern only direct third-party access to the REST API with the publishable key.
--
-- Verified after applying, as anon: 125,037 / 8,244 rows still selectable; DELETE and UPDATE affect
-- 0 rows; INSERT raises insufficient_privilege. As service_role: both tables still fully writable.
-- End to end through the app's own code path: listStoredElectionCandidates() returns 8,244, the
-- lobbying_filings read returns rows, and lobbying_graph_rollup returns 745.

alter table public.lobbying_filings enable row level security;
alter table public.election_candidates enable row level security;

create policy "public read" on public.lobbying_filings
  for select to anon, authenticated using (true);

create policy "public read" on public.election_candidates
  for select to anon, authenticated using (true);

-- Left as they are: sync_runs and sync_errors have RLS on with no policy at all, which the linter
-- reports at INFO. That is the intended shape -- they are operational sync records, not public
-- civic data, so anon should see nothing and the service-key writes go through regardless.
