-- Lobbying, made to answer "who is lobbying on this bill" and to count money once.
--
-- Until now lobbying_filings held original quarterly reports only (filing types Q1-Q4) and every
-- figure summed them. Two things were wrong with that:
--
--   1. Amendments (1A-4A) and termination reports (1T-4T, 1@-4@) were never ingested. An amendment
--      restates the whole report for its quarter, so the right figure for a firm/client/quarter is
--      the *latest* report posted, whichever type it is. is_current marks that one, and
--      lobbying_refresh_current keeps it right after each sync.
--   2. An organization that lobbies in-house reports its total lobbying expense, which already
--      includes what it paid outside firms -- and those firms report the same money as income.
--      Summing both counted it twice. lobbying_counted keeps a client's in-house report and drops
--      its firms' reports for any quarter it self-filed.
--
-- And the useful part was never stored: each filing's activities name issue codes and, in about a
-- third of filings, the specific bills lobbied on. issue_codes and lobbying_bill_mentions keep
-- only those -- not the free-text descriptions, which would be ~30MB against the 500MB cap.
--
-- Clients are keyed by client_key (lib/organization-names.ts organizationKey), not client_id: the
-- LDA's client ids are per firm, so a company that hires five firms has five of them.

alter table public.lobbying_filings
  add column if not exists client_key text,
  add column if not exists issue_codes text[] not null default '{}',
  add column if not exists is_current boolean not null default true;

-- Derivable from the uuid (lib/lobbying/lda-text.ts filingDocumentUrl); ~9MB of repeated prefix.
alter table public.lobbying_filings drop column if exists filing_url;

drop index if exists public.lobbying_filings_client_name_idx;
create index if not exists lobbying_filings_client_key_idx
  on public.lobbying_filings (client_key, filing_year) where is_current;
create index if not exists lobbying_filings_current_year_idx
  on public.lobbying_filings (filing_year, filing_period) where is_current;
create index if not exists lobbying_filings_supersede_idx
  on public.lobbying_filings (registrant_id, client_key, filing_year, filing_period);
create index if not exists lobbying_filings_posted_idx on public.lobbying_filings (posted_at);

create table if not exists public.lobbying_bill_mentions (
  bill_id text not null references public.bills(id) on delete cascade,
  filing_uuid text not null references public.lobbying_filings(filing_uuid) on delete cascade,
  primary key (bill_id, filing_uuid)
);
create index if not exists lobbying_bill_mentions_filing_idx on public.lobbying_bill_mentions (filing_uuid);
alter table public.lobbying_bill_mentions enable row level security;

/*
 * The cursor for the incremental sync: filings arrive in posting order, so the newest posted_at
 * already stored is where the next run resumes.
 */
create table if not exists public.lobbying_sync_state (
  id text primary key default 'default',
  posted_after timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.lobbying_sync_state enable row level security;

/* 2026 Q2 -> 20262. Sortable, and compact enough to carry through aggregates. */
create or replace function public.lobbying_quarter_index(p_year integer, p_period text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_year * 10 + case p_period
    when 'first_quarter' then 1
    when 'second_quarter' then 2
    when 'third_quarter' then 3
    when 'fourth_quarter' then 4
    else 0
  end;
$$;

/* Marks the latest report posted for each firm/client/quarter, and only that one, as current. */
create or replace function public.lobbying_refresh_current(p_years integer[])
returns integer
language sql
set search_path = public, pg_temp
as $$
  with ranked as (
    select
      filing_uuid,
      row_number() over (
        partition by registrant_id, client_key, filing_year, filing_period
        order by posted_at desc nulls last, filing_uuid desc
      ) = 1 as latest
    from public.lobbying_filings
    where filing_year = any(p_years)
  ),
  changed as (
    update public.lobbying_filings f
    set is_current = r.latest
    from ranked r
    where r.filing_uuid = f.filing_uuid
      and f.is_current is distinct from r.latest
    returning 1
  )
  select count(*)::integer from changed;
$$;

/*
 * Current reports whose money counts toward a client's spend: every in-house report, and a firm's
 * report only when the client did not self-file for that quarter.
 */
create or replace view public.lobbying_counted with (security_invoker = true) as
select f.*
from public.lobbying_filings f
where f.is_current
  and (
    f.is_in_house
    or not exists (
      select 1
      from public.lobbying_filings s
      where s.is_current
        and s.is_in_house
        and s.client_key = f.client_key
        and s.filing_year = f.filing_year
        and s.filing_period = f.filing_period
    )
  );

/* Totals for a year, one row per quarter plus a 'year' row. */
create or replace function public.lobbying_overview(p_year integer)
returns table (period text, spend numeric, reports bigint, clients bigint, firms bigint)
language sql
stable
set search_path = public, pg_temp
as $$
  with spend as (
    select coalesce(filing_period, 'year') as period, sum(coalesce(amount, 0)) as spend
    from public.lobbying_counted
    where filing_year = p_year
    group by grouping sets ((filing_period), ())
  ),
  activity as (
    select
      coalesce(filing_period, 'year') as period,
      count(*) as reports,
      count(distinct client_key) as clients,
      count(distinct registrant_id) filter (where not is_in_house) as firms
    from public.lobbying_filings
    where is_current and filing_year = p_year
    group by grouping sets ((filing_period), ())
  )
  select a.period, coalesce(s.spend, 0), a.reports, a.clients, a.firms
  from activity a
  left join spend s using (period);
$$;

create or replace function public.lobbying_top_clients(p_year integer, p_limit integer default 25, p_search text default null)
returns table (
  client_key text,
  client_name text,
  spend numeric,
  firms bigint,
  reports bigint,
  bills bigint,
  in_house boolean
)
language sql
stable
set search_path = public, pg_temp
as $$
  with current_reports as (
    select *
    from public.lobbying_filings
    where is_current
      and filing_year = p_year
      and (p_search is null or client_key like '%' || p_search || '%')
  ),
  clients as (
    select
      client_key,
      max(client_name) as client_name,
      count(distinct registrant_id) filter (where not is_in_house) as firms,
      count(*) as reports,
      bool_or(is_in_house) as in_house
    from current_reports
    group by client_key
  ),
  spend as (
    select c.client_key, sum(coalesce(c.amount, 0)) as spend
    from public.lobbying_counted c
    where c.filing_year = p_year
      and (p_search is null or c.client_key like '%' || p_search || '%')
    group by c.client_key
  ),
  bills as (
    select r.client_key, count(distinct m.bill_id) as bills
    from current_reports r
    join public.lobbying_bill_mentions m using (filing_uuid)
    group by r.client_key
  )
  select c.client_key, c.client_name, coalesce(s.spend, 0), c.firms, c.reports, coalesce(b.bills, 0), c.in_house
  from clients c
  left join spend s using (client_key)
  left join bills b using (client_key)
  order by coalesce(s.spend, 0) desc, c.client_key
  limit greatest(1, least(p_limit, 200));
$$;

create or replace function public.lobbying_top_firms(p_year integer, p_limit integer default 25)
returns table (registrant_id text, registrant_name text, income numeric, clients bigint)
language sql
stable
set search_path = public, pg_temp
as $$
  select registrant_id, max(registrant_name), sum(coalesce(amount, 0)), count(distinct client_key)
  from public.lobbying_filings
  where is_current and filing_year = p_year and not is_in_house
  group by registrant_id
  order by 3 desc, registrant_id
  limit greatest(1, least(p_limit, 200));
$$;

/*
 * Bills ranked by how many organizations reported lobbying on them. Optionally narrowed to one
 * issue (issue_bill_links) or one sponsor (bills.sponsor_id).
 */
create or replace function public.lobbying_top_bills(
  p_years integer[],
  p_limit integer default 25,
  p_issue text default null,
  p_sponsor text default null
)
returns table (
  bill_id text,
  number text,
  title text,
  status text,
  sponsor_name text,
  clients bigint,
  reports bigint,
  last_quarter integer
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    m.bill_id,
    b.number,
    b.title,
    b.status,
    b.sponsor_name,
    count(distinct f.client_key),
    count(*),
    max(public.lobbying_quarter_index(f.filing_year, f.filing_period))
  from public.lobbying_bill_mentions m
  join public.lobbying_filings f using (filing_uuid)
  join public.bills b on b.id = m.bill_id
  where f.is_current
    and f.filing_year = any(p_years)
    and (p_sponsor is null or b.sponsor_id = p_sponsor)
    and (p_issue is null or exists (
      select 1 from public.issue_bill_links l where l.bill_id = m.bill_id and l.issue_id = p_issue
    ))
  group by m.bill_id, b.number, b.title, b.status, b.sponsor_name
  order by 6 desc, 7 desc, m.bill_id
  limit greatest(1, least(p_limit, 200));
$$;

/* Everyone who reported lobbying on one bill. */
create or replace function public.lobbying_bill_clients(p_bill_id text)
returns table (
  client_key text,
  client_name text,
  firms text[],
  in_house boolean,
  reports bigint,
  first_quarter integer,
  last_quarter integer,
  latest_filing_uuid text,
  issue_codes text[]
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    f.client_key,
    max(f.client_name),
    coalesce(array_agg(distinct f.registrant_name) filter (where not f.is_in_house and f.registrant_name is not null), '{}'),
    bool_or(f.is_in_house),
    count(*),
    min(public.lobbying_quarter_index(f.filing_year, f.filing_period)),
    max(public.lobbying_quarter_index(f.filing_year, f.filing_period)),
    (array_agg(f.filing_uuid order by f.posted_at desc nulls last))[1],
    (select coalesce(array_agg(distinct code), '{}') from unnest(array_agg(f.issue_codes)) as code)
  from public.lobbying_bill_mentions m
  join public.lobbying_filings f using (filing_uuid)
  where m.bill_id = p_bill_id and f.is_current
  group by f.client_key
  order by count(*) desc, 7 desc, f.client_key;
$$;

create or replace function public.lobbying_issue_counts(p_year integer)
returns table (issue_code text, reports bigint, clients bigint)
language sql
stable
set search_path = public, pg_temp
as $$
  select code, count(*), count(distinct f.client_key)
  from public.lobbying_filings f
  cross join lateral unnest(f.issue_codes) as code
  where f.is_current and f.filing_year = p_year
  group by code
  order by 3 desc, code;
$$;

/* One client: spend by quarter, the firms it hired, the bills and issues it lobbied on, its reports. */
create or replace function public.lobbying_client_detail(p_client_key text)
returns json
language sql
stable
set search_path = public, pg_temp
as $$
  select json_build_object(
    'client_key', p_client_key,
    'name', (select max(client_name) from public.lobbying_filings where client_key = p_client_key),
    'in_house', (select coalesce(bool_or(is_in_house), false) from public.lobbying_filings where client_key = p_client_key and is_current),
    'quarters', (
      select coalesce(json_agg(q order by q.quarter), '[]')
      from (
        select public.lobbying_quarter_index(filing_year, filing_period) as quarter, sum(coalesce(amount, 0)) as spend
        from public.lobbying_counted
        where client_key = p_client_key
        group by 1
      ) q
    ),
    'firms', (
      select coalesce(json_agg(r order by r.amount desc nulls last), '[]')
      from (
        select
          registrant_id,
          max(registrant_name) as name,
          bool_or(is_in_house) as in_house,
          sum(coalesce(amount, 0)) as amount,
          count(*) as reports,
          max(public.lobbying_quarter_index(filing_year, filing_period)) as last_quarter
        from public.lobbying_filings
        where client_key = p_client_key and is_current
        group by registrant_id
      ) r
    ),
    'bills', (
      select coalesce(json_agg(x order by x.reports desc, x.bill_id), '[]')
      from (
        select m.bill_id, b.number, b.title, b.status, count(*) as reports,
          max(public.lobbying_quarter_index(f.filing_year, f.filing_period)) as last_quarter
        from public.lobbying_filings f
        join public.lobbying_bill_mentions m using (filing_uuid)
        join public.bills b on b.id = m.bill_id
        where f.client_key = p_client_key and f.is_current
        group by m.bill_id, b.number, b.title, b.status
      ) x
    ),
    'issues', (
      select coalesce(json_agg(i order by i.reports desc, i.code), '[]')
      from (
        select code, count(*) as reports
        from public.lobbying_filings f
        cross join lateral unnest(f.issue_codes) as code
        where f.client_key = p_client_key and f.is_current
        group by code
      ) i
    ),
    'reports', (
      select coalesce(json_agg(r order by r.quarter desc, r.registrant_name), '[]')
      from (
        select
          filing_uuid,
          public.lobbying_quarter_index(filing_year, filing_period) as quarter,
          filing_type,
          registrant_name,
          is_in_house,
          amount
        from public.lobbying_filings
        where client_key = p_client_key and is_current
        order by 2 desc
        limit 60
      ) r
    )
  );
$$;

/* The funding-graph rollup, now over current reports only so amendments do not double it. */
create or replace function public.lobbying_graph_rollup(p_years integer[] default null)
returns table (
  registrant_id text,
  registrant_name text,
  client_id text,
  client_name text,
  is_in_house boolean,
  total_amount numeric,
  filing_count bigint,
  first_year integer,
  last_year integer
)
language sql
stable
set search_path = public, pg_temp
as $$
  with grouped as (
    select
      f.registrant_id,
      max(f.registrant_name) as registrant_name,
      f.client_id,
      max(f.client_name) as client_name,
      bool_or(f.is_in_house) as is_in_house,
      coalesce(sum(f.amount), 0) as total_amount,
      count(*) as filing_count,
      min(f.filing_year) as first_year,
      max(f.filing_year) as last_year
    from public.lobbying_filings f
    where (p_years is null or f.filing_year = any(p_years))
      and f.is_current
      and f.registrant_id is not null
      and f.client_id is not null
    group by f.registrant_id, f.client_id
  )
  select g.*
  from grouped g
  where exists (
    select 1
    from public.graph_entities e
    where e.entity_type = 'employer'
      and e.id = 'fec-emp-' || regexp_replace(
        btrim(regexp_replace(lower(coalesce(g.client_name, '')), '[^a-z0-9 -]', '', 'g')),
        '\s+', '-', 'g')
  )
  order by g.total_amount desc;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'lobbying_quarter_index(integer, text)',
    'lobbying_refresh_current(integer[])',
    'lobbying_overview(integer)',
    'lobbying_top_clients(integer, integer, text)',
    'lobbying_top_firms(integer, integer)',
    'lobbying_top_bills(integer[], integer, text, text)',
    'lobbying_bill_clients(text)',
    'lobbying_issue_counts(integer)',
    'lobbying_client_detail(text)',
    'lobbying_graph_rollup(integer[])'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;

revoke all on public.lobbying_counted from anon, authenticated;
revoke all on public.lobbying_bill_mentions from anon, authenticated;
revoke all on public.lobbying_sync_state from anon, authenticated;
grant select, insert, update, delete on public.lobbying_bill_mentions, public.lobbying_sync_state to service_role;
grant select on public.lobbying_counted to service_role;

/*
 * Applied as a follow-up: re-ranking a whole year per sync slice hit the statement timeout, so the
 * sync re-ranks only the firm/client/quarter groups its reports belong to.
 */
create or replace function public.lobbying_refresh_current_for(p_filing_uuids text[])
returns integer
language sql
set search_path = public, pg_temp
as $$
  with touched as (
    select distinct registrant_id, client_key, filing_year, filing_period
    from public.lobbying_filings
    where filing_uuid = any(p_filing_uuids)
  ),
  ranked as (
    select
      f.filing_uuid,
      row_number() over (
        partition by f.registrant_id, f.client_key, f.filing_year, f.filing_period
        order by f.posted_at desc nulls last, f.filing_uuid desc
      ) = 1 as latest
    from public.lobbying_filings f
    join touched t
      on t.registrant_id = f.registrant_id
     and t.client_key = f.client_key
     and t.filing_year = f.filing_year
     and t.filing_period = f.filing_period
  ),
  changed as (
    update public.lobbying_filings f
    set is_current = r.latest
    from ranked r
    where r.filing_uuid = f.filing_uuid
      and f.is_current is distinct from r.latest
    returning 1
  )
  select count(*)::integer from changed;
$$;

revoke execute on function public.lobbying_refresh_current_for(text[]) from public, anon, authenticated;
grant execute on function public.lobbying_refresh_current_for(text[]) to service_role;

/*
 * Follow-up fix, applied: array_agg over issue_codes failed ("cannot accumulate arrays of
 * different dimensionality") whenever a bill's reports mixed empty and non-empty code lists, so
 * the function errored for most bills. Codes are unnested first instead.
 */
create or replace function public.lobbying_bill_clients(p_bill_id text)
returns table (
  client_key text,
  client_name text,
  firms text[],
  in_house boolean,
  reports bigint,
  first_quarter integer,
  last_quarter integer,
  latest_filing_uuid text,
  issue_codes text[]
)
language sql
stable
set search_path = public, pg_temp
as $$
  with reports as (
    select f.*
    from public.lobbying_bill_mentions m
    join public.lobbying_filings f using (filing_uuid)
    where m.bill_id = p_bill_id and f.is_current
  ),
  codes as (
    select r.client_key, array_agg(distinct code order by code) as issue_codes
    from reports r
    cross join lateral unnest(r.issue_codes) as code
    group by r.client_key
  )
  select
    r.client_key,
    max(r.client_name),
    coalesce(array_agg(distinct r.registrant_name) filter (where not r.is_in_house and r.registrant_name is not null), '{}'),
    bool_or(r.is_in_house),
    count(*),
    min(public.lobbying_quarter_index(r.filing_year, r.filing_period)),
    max(public.lobbying_quarter_index(r.filing_year, r.filing_period)),
    (array_agg(r.filing_uuid order by r.posted_at desc nulls last))[1],
    coalesce(max(c.issue_codes), '{}')
  from reports r
  left join codes c using (client_key)
  group by r.client_key
  order by count(*) desc, 7 desc, r.client_key;
$$;

revoke execute on function public.lobbying_bill_clients(text) from public, anon, authenticated;
grant execute on function public.lobbying_bill_clients(text) to service_role;

/*
 * Second follow-up, applied: PostgREST caps a response at 1,000 rows, so H.R. 1 showed exactly
 * "1,000 organizations". The function now returns at most p_limit rows plus the true totals on
 * every row.
 */
drop function if exists public.lobbying_bill_clients(text);

create or replace function public.lobbying_bill_clients(p_bill_id text, p_limit integer default 100)
returns table (
  client_key text,
  client_name text,
  firms text[],
  in_house boolean,
  reports bigint,
  first_quarter integer,
  last_quarter integer,
  latest_filing_uuid text,
  issue_codes text[],
  total_clients bigint,
  total_firms bigint
)
language sql
stable
set search_path = public, pg_temp
as $$
  with reports as (
    select f.*
    from public.lobbying_bill_mentions m
    join public.lobbying_filings f using (filing_uuid)
    where m.bill_id = p_bill_id and f.is_current
  ),
  totals as (
    select
      count(distinct client_key) as total_clients,
      count(distinct registrant_id) filter (where not is_in_house) as total_firms
    from reports
  ),
  codes as (
    select r.client_key, array_agg(distinct code order by code) as issue_codes
    from reports r
    cross join lateral unnest(r.issue_codes) as code
    group by r.client_key
  )
  select
    r.client_key,
    max(r.client_name),
    coalesce(array_agg(distinct r.registrant_name) filter (where not r.is_in_house and r.registrant_name is not null), '{}'),
    bool_or(r.is_in_house),
    count(*),
    min(public.lobbying_quarter_index(r.filing_year, r.filing_period)),
    max(public.lobbying_quarter_index(r.filing_year, r.filing_period)),
    (array_agg(r.filing_uuid order by r.posted_at desc nulls last))[1],
    coalesce(max(c.issue_codes), '{}'),
    max(t.total_clients),
    max(t.total_firms)
  from reports r
  cross join totals t
  left join codes c using (client_key)
  group by r.client_key
  order by count(*) desc, 7 desc, r.client_key
  limit greatest(1, least(p_limit, 500));
$$;

revoke execute on function public.lobbying_bill_clients(text, integer) from public, anon, authenticated;
grant execute on function public.lobbying_bill_clients(text, integer) to service_role;
