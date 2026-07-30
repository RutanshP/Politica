-- Storage reclaim, measured at 414MB of the 500MB ceiling.
--
-- 1. bills.raw_bill was 44MB of TOAST -- 11% of the whole database -- holding the Congress.gov
--    payload for all 19,134 bills. Nothing ever read it: the sync selected it on every run only to
--    write it straight back, and its one consumer was `Boolean(raw_bill)` behind a `rawAvailable`
--    flag that no component renders. Selecting it on each run was also a significant share of the
--    egress. The sync no longer reads or writes the column, so this drains what is already there.
--    (Exactly the reasoning behind the votes.raw_payload reclaim in 018.)
--
-- 2. search_documents_trgm_idx was 15MB and had never been scanned -- not once, and pg_stat_database
--    reports stats have never been reset, so that is a lifetime count. It indexes the expression
--    (label || ' ' || title || ' ' || description), but global search filters each column
--    separately (`or=(label.ilike.*q*,title.ilike.*q*,...)`), which a concatenated-expression index
--    cannot serve. It was structurally unusable rather than merely unused. A 16k-row sequential
--    scan is what has been answering search all along.
--
-- 3. entities and entity_relationships are both empty -- the rebuild that fills them had been
--    failing since 2026-07-20 -- but still held 7.4MB and 1.2MB of pages never returned to the OS,
--    having never been vacuumed.
--
-- Left alone deliberately:
--   * bills_search_text_trgm_idx (14MB, 0 scans) backs a real feature (bill directory search) and
--     is usable by its query; it simply has not been exercised yet.
--   * bills_source_fingerprint_idx / bills_source_updated_at_idx (0 scans) become useful now that
--     the incremental freshness comparison actually works.
--   * lobbying_filings (50MB) is real data, not bloat.
drop index if exists public.search_documents_trgm_idx;

update public.bills set raw_bill = null where raw_bill is not null;

-- vacuum full rewrites the table, returning the freed TOAST pages to the filesystem rather than
-- leaving them as reusable free space inside the relation.
vacuum full public.bills;
vacuum full public.entities;
vacuum full public.entity_relationships;
