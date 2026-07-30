-- Storage reclaim, measured against the 500MB ceiling.
--
-- RUN PART A FIRST, THEN PART B. Part B is VACUUM, which Postgres refuses to run inside a
-- transaction block ("ERROR: 25001"). Supabase's SQL runner wraps a submitted script in one, so
-- Part B has to be sent on its own -- one statement at a time in the dashboard editor, or via psql
-- with the connection string from Project Settings > Database.
--
-- The order matters. When this was written the database was at 448MB of 500MB, and VACUUM FULL
-- writes a complete second copy of a table before dropping the original: bills would need ~94MB of
-- headroom against ~52MB free. Part A frees ~24MB cheaply and shrinks bills' TOAST to nothing
-- first, so the plain VACUUM in Part B can return that space without ever doubling the table.
--
-- What each piece is for:
--
-- 1. bills.raw_bill held 44MB of TOAST -- the Congress.gov payload for all 19,134 bills -- and
--    nothing ever read it. The sync selected it on every run only to write it straight back, and its
--    sole consumer was `Boolean(raw_bill)` behind a `rawAvailable` flag no component renders. The
--    sync no longer touches the column; this drains what is stored. Same call as 018 on
--    votes.raw_payload.
--
-- 2. search_documents_trgm_idx was 15MB and had never been scanned once (pg_stat_database reports
--    stats have never been reset, so that is a lifetime count). It indexes the expression
--    (label || ' ' || title || ' ' || description), while global search filters each column
--    separately -- `or=(label.ilike.*q*,title.ilike.*q*,...)` -- which a concatenated-expression
--    index cannot serve. Structurally unusable, not merely unused; a 16k-row sequential scan is
--    what has been answering search all along.
--
-- 3. entities and entity_relationships are empty -- the rebuild that fills them failed from
--    2026-07-20 until it was repaired -- yet still held 7.4MB and 1.2MB of pages never returned to
--    the OS. TRUNCATE recreates the underlying files, so it reclaims them immediately and, unlike
--    VACUUM FULL, is transaction-safe. Neither table has an inbound foreign key.
--
-- Left alone deliberately:
--   * bills_search_text_trgm_idx (14MB, 0 scans) backs bill-directory search and its query *can*
--     use it; it simply has not been exercised yet.
--   * bills_source_fingerprint_idx / bills_source_updated_at_idx (0 scans) become useful now that
--     the incremental freshness comparison actually works.
--   * lobbying_filings (50MB) is real data, not bloat.

-- ---------------------------------------------------------------------------
-- PART A -- transaction-safe, run as one script
-- ---------------------------------------------------------------------------

drop index if exists public.search_documents_trgm_idx;

truncate table public.entities, public.entity_relationships;

update public.bills set raw_bill = null where raw_bill is not null;

-- ---------------------------------------------------------------------------
-- PART B -- run each statement separately, OUTSIDE a transaction
-- ---------------------------------------------------------------------------

-- Clears the dead heap rows left by the repeated full re-syncs. Does NOT recover the raw_bill space:
-- plain VACUUM only truncates *trailing* empty pages, and the dead TOAST chunks are scattered
-- through the file, so this left the TOAST table at its full 44MB (measured -- don't expect
-- otherwise). It is still worth running first to settle the heap.
vacuum (analyze) public.bills;

-- This is what actually returns the 44MB.
--
-- `vacuum full public.bills` would be the obvious move but does not fit: it writes a complete second
-- copy of the heap and every index (~94MB) before dropping the original, against ~76MB free at the
-- time. Vacuuming the TOAST table on its own rewrites only the toasted values -- and after Part A
-- almost all of those are dead, so the new copy is small and the rewrite needs virtually no
-- headroom. Took bills from 138MB to 112MB and the database from 424MB to 398MB.
--
-- The OID is per-table and per-database, so look it up rather than reusing the one below:
--   select c.reltoastrelid::regclass from pg_class c where c.oid = 'public.bills'::regclass;
vacuum full pg_toast.pg_toast_17641;

-- The 18MB of TOAST that remains is bills.summary, which is real data.
