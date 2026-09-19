-- Two advisor findings. Already applied.
--
-- pg_trgm lived in public, where its ~40 functions sat alongside the app's own and were exposed
-- through PostgREST's schema. Moved to `extensions`. Its one dependent, bills_search_text_trgm_idx,
-- references the operator class by oid and keeps working -- verified with EXPLAIN that an ILIKE on
-- bills.search_text still plans a Bitmap Index Scan on it. Nothing in the app calls similarity()
-- or the % operator by name, so no search_path change is needed.
--
-- pac_committees.sponsor_politician_id is a foreign key with no index: deleting or re-keying a
-- politician scanned the whole table. Partial, because only leadership PACs have a sponsor.

create schema if not exists extensions;
grant usage on schema extensions to postgres, service_role;
alter extension pg_trgm set schema extensions;

create index if not exists pac_committees_sponsor_politician_idx
  on public.pac_committees (sponsor_politician_id)
  where sponsor_politician_id is not null;
