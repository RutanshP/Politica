-- Politica performance migration.
--
-- Fixes three structural problems in the read path:
--   1. `last_action_at` / `introduced_at` / `date_label` are text columns holding human dates
--      ("Mar 27, 2025", "March 12, 2025,  11:58 AM"), so ORDER BY on them sorts alphabetically.
--      September 2025 sorts above June 2026. We add real timestamptz sort keys.
--   2. The bills directory filters on chamber/state/sponsor_name/committee_name and sorts on
--      last_action_at -- none of which had an index.
--   3. Filter dropdowns were built by downloading every bill row and running DISTINCT in JS.
--      They now come from one indexed function call.

-- ---------------------------------------------------------------------------
-- 1. Display-date parser
-- ---------------------------------------------------------------------------
-- Handles every format present in the data (verified against all 17,862 production rows):
--   "Mar 27, 2025"                 (abbreviated month, no time)      -- 16,752 rows
--   "March 12, 2025,  11:58 AM"    (full month + 12h time)           --  1,072 rows
--   "May 13, 2026,  05:35 PM"      (abbreviated month + 12h time)    --     31 rows
--   "12-Jun-2025"                  (DD-Mon-YYYY, from OpenStates)    --      7 rows
--   "", "Unknown", NULL            -> NULL                           --      1 row
-- Matches on the first three letters of the month so abbreviated and full names share a path.
-- IMMUTABLE (make_timestamp + explicit UTC, no dependency on the TimeZone GUC) so it is legal
-- in a generated column and an index expression.
create or replace function public.politica_parse_display_date(value text)
returns timestamptz
language plpgsql
immutable
as $$
declare
  parts text[];
  month_number int;
  hour_number int;
begin
  -- "Mon DD, YYYY" / "Month DD, YYYY[, HH:MM AM]"  -> [month, day, year, hh, mm, meridiem]
  parts := regexp_match(
    coalesce(value, ''),
    '^\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:,\s*(\d{1,2}):(\d{2})\s*([APap][Mm]))?'
  );

  -- "DD-Mon-YYYY" -> reorder into the same [month, day, year] shape
  if parts is null then
    parts := regexp_match(coalesce(value, ''), '^\s*(\d{1,2})-([A-Za-z]+)-(\d{4})\s*$');
    if parts is not null then
      parts := array[parts[2], parts[1], parts[3], null, null, null];
    end if;
  end if;

  if parts is null then
    return null;
  end if;

  month_number := case lower(left(parts[1], 3))
    when 'jan' then 1  when 'feb' then 2  when 'mar' then 3  when 'apr' then 4
    when 'may' then 5  when 'jun' then 6  when 'jul' then 7  when 'aug' then 8
    when 'sep' then 9  when 'oct' then 10 when 'nov' then 11 when 'dec' then 12
    else null
  end;

  if month_number is null then
    return null;
  end if;

  hour_number := coalesce(parts[4]::int, 0);
  if parts[6] is not null then
    if upper(parts[6]) = 'PM' and hour_number < 12 then
      hour_number := hour_number + 12;
    elsif upper(parts[6]) = 'AM' and hour_number = 12 then
      hour_number := 0;
    end if;
  end if;

  return make_timestamp(
    parts[3]::int,
    month_number,
    parts[2]::int,
    hour_number,
    coalesce(parts[5]::int, 0),
    0
  ) at time zone 'UTC';
exception
  when others then
    return null;  -- malformed dates (e.g. Feb 31) sort last rather than failing the write
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Real sort keys, as generated columns
-- ---------------------------------------------------------------------------
-- Generated (not backfilled) so every future upsert stays correct with no writer changes,
-- and the sort key can never drift from the display text it is derived from.
-- The original text columns are left untouched -- the UI still renders those.
alter table public.bills
  add column if not exists last_action_on timestamptz
  generated always as (public.politica_parse_display_date(last_action_at)) stored;

alter table public.bills
  add column if not exists introduced_on timestamptz
  generated always as (public.politica_parse_display_date(introduced_at)) stored;

alter table public.votes
  add column if not exists voted_on timestamptz
  generated always as (public.politica_parse_display_date(date_label)) stored;

-- ---------------------------------------------------------------------------
-- 3. One search column instead of a 5-way unanchored ILIKE
-- ---------------------------------------------------------------------------
-- The directory searched with or(number.ilike.*q*, title.ilike.*q*, topic.ilike.*q*,
-- sponsor_name.ilike.*q*, committee_name.ilike.*q*) -- five leading-wildcard predicates,
-- each of which forces a sequential scan. One concatenated column + one trigram index
-- serves the same query from an index.
alter table public.bills
  add column if not exists search_text text
  generated always as (
    number || ' ' || title || ' ' || topic || ' ' || sponsor_name || ' ' || committee_name
  ) stored;

create extension if not exists pg_trgm;

create index if not exists bills_search_text_trgm_idx
  on public.bills using gin (search_text gin_trgm_ops);

create index if not exists search_documents_trgm_idx
  on public.search_documents using gin (
    (label || ' ' || title || ' ' || description) gin_trgm_ops
  );

-- ---------------------------------------------------------------------------
-- 4. Indexes for the directory's actual filter + sort columns
-- ---------------------------------------------------------------------------
create index if not exists bills_last_action_on_idx
  on public.bills (last_action_on desc nulls last);

-- Covers the default directory query: filter by jurisdiction_type + session, sort by recency.
create index if not exists bills_directory_idx
  on public.bills (jurisdiction_type, session, last_action_on desc nulls last);

create index if not exists bills_chamber_idx        on public.bills (chamber);
create index if not exists bills_state_idx          on public.bills (state);
create index if not exists bills_sponsor_name_idx   on public.bills (sponsor_name);
create index if not exists bills_committee_name_idx on public.bills (committee_name);
create index if not exists bills_number_idx         on public.bills (number);
create index if not exists bills_title_idx          on public.bills (title);

create index if not exists votes_voted_on_idx on public.votes (voted_on desc nulls last);
create index if not exists votes_source_system_idx on public.votes (source_system);
create index if not exists committees_jurisdiction_type_idx
  on public.committees (jurisdiction_type);

-- getLatestSyncRun does pipeline=eq.X&order=started_at.desc&limit=1 on every page render.
create index if not exists sync_runs_pipeline_started_idx
  on public.sync_runs (pipeline, started_at desc);

-- ---------------------------------------------------------------------------
-- 5. Unindexed FK columns behind ON DELETE CASCADE
-- ---------------------------------------------------------------------------
-- Without these, every delete from politicians/bills/entities sequentially scans the child
-- table once per deleted row to enforce the constraint. The sync pipelines delete in bulk.
create index if not exists finance_edges_source_idx
  on public.finance_edges (source);
create index if not exists finance_edges_target_idx
  on public.finance_edges (target);
create index if not exists candidate_finance_snapshots_politician_id_idx
  on public.candidate_finance_snapshots (politician_id);
create index if not exists issue_bill_links_bill_id_idx
  on public.issue_bill_links (bill_id);
create index if not exists news_entity_links_entity_id_idx
  on public.news_entity_links (entity_id);
create index if not exists legislative_sessions_jurisdiction_id_idx
  on public.legislative_sessions (jurisdiction_id);
create index if not exists entity_relationships_source_idx
  on public.entity_relationships (source_entity_id);
create index if not exists entity_relationships_target_idx
  on public.entity_relationships (target_entity_id);

-- Exactly duplicates the primary key (bill_id, sort_order): pure write cost, no read benefit.
drop index if exists public.bill_actions_bill_id_sort_order_idx;

-- ---------------------------------------------------------------------------
-- 6. Directory facets as a function instead of a full-table download
-- ---------------------------------------------------------------------------
-- Replaces listStoredBillDirectoryFacets(), which paged through every bill row (17.8k rows,
-- 36 sequential requests, ~20s measured) to derive ~35 distinct dropdown values in JS.
--
-- STABLE, so PostgREST exposes it over GET -- which means Next's fetch Data Cache can cache it.
-- (A POST /rpc call would not be cached.)
--
-- The predicate mirrors buildStoredBillsPageFilterQuery: all state bills, plus federal bills
-- for the current Congress only.
create or replace function public.bill_directory_facets(p_session text)
returns table (facet text, value text)
language sql
stable
as $$
  with scoped as (
    select *
    from public.bills
    where jurisdiction_type = 'state'
       or (jurisdiction_type = 'federal' and session = p_session)
  )
  select 'level'::text,     case when jurisdiction_type = 'state' then 'State' else 'Federal' end
    from scoped group by 1, 2
  union all
  select 'state'::text,     state          from scoped where state          is not null and state          <> '' group by 1, 2
  union all
  select 'chamber'::text,   chamber        from scoped where chamber        is not null and chamber        <> '' group by 1, 2
  union all
  select 'status'::text,    status         from scoped where status         is not null and status         <> '' group by 1, 2
  union all
  select 'session'::text,   session        from scoped where session        is not null and session        <> '' group by 1, 2
  union all
  select 'topic'::text,     topic          from scoped where topic          is not null and topic          <> '' group by 1, 2
  union all
  select 'sponsor'::text,   sponsor_name   from scoped where sponsor_name   is not null and sponsor_name   <> '' group by 1, 2
  union all
  select 'committee'::text, committee_name from scoped where committee_name is not null and committee_name <> '' group by 1, 2
  order by 1, 2;
$$;

analyze public.bills;
analyze public.votes;
