-- Locks the publishable (anon) key out of the database entirely.
--
-- Every read and write in Politica goes through lib/supabase/rest.ts, server-side, with the secret
-- key. Nothing ever uses the publishable key, yet it ships in the browser bundle and held full
-- table privileges on all 36 public tables. RLS made that mostly harmless -- each table has only a
-- read policy -- but not entirely:
--
--   * TRUNCATE is not subject to RLS. PostgREST cannot issue it today, but the grant was there.
--   * Every public function was executable by anon over /rpc, including lobbying_graph_rollup,
--     which aggregates all 125k lobbying filings on each call -- a free way to load the database.
--
-- Also pins search_path on the four functions the security advisor flagged
-- (function_search_path_mutable).
--
-- If a client-side Supabase read is ever added, grant SELECT on just the tables it needs.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated, public;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

grant execute on all functions in schema public to service_role;

alter function public.bill_directory_facets(text) set search_path = public, pg_temp;
alter function public.politician_vote_stat_counters(text[]) set search_path = public, pg_temp;
alter function public.reconcile_politician_vote_stats(text[]) set search_path = public, pg_temp;
alter function public.lobbying_graph_rollup(integer[]) set search_path = public, pg_temp;
