-- Lobbying reads, made fast enough to serve. Already applied.
--
-- The aggregate functions in 033 were written against a partial backfill. With all 153k reports and
-- 193k bill mentions stored they cost: top_bills 8.4s (it timed out through PostgREST and the bill
-- rankings silently vanished from every page), top_clients 1.8s, client_index 5.5s. Three changes:
--
--   1. lobbying_bill_stats holds per-bill counts, refreshed after each sync. Ranking bills live
--      meant counting distinct organizations across a 193k-row join on every page view. filing_year
--      0 is the whole Congress, because distinct organizations cannot be summed across years.
--   2. top_clients and client_index rank on spend first and describe only the rows that survive,
--      instead of counting every client's firms and bills up front.
--   3. lobbying_counted anti-joins the self-filed quarters instead of running a NOT EXISTS per row.
--
-- After: top_bills 10ms, top_clients 256ms, client_index 566ms, overview 307ms.

create table if not exists public.lobbying_bill_stats (
  bill_id text not null references public.bills(id) on delete cascade,
  filing_year integer not null,
  clients integer not null,
  reports integer not null,
  last_quarter integer not null,
  primary key (bill_id, filing_year)
);
create index if not exists lobbying_bill_stats_rank_idx on public.lobbying_bill_stats (filing_year, clients desc, reports desc);
alter table public.lobbying_bill_stats enable row level security;
revoke all on public.lobbying_bill_stats from anon, authenticated;
grant select, insert, update, delete on public.lobbying_bill_stats to service_role;

create or replace function public.lobbying_refresh_bill_stats()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  written integer;
begin
  create temporary table tmp_bill_stats on commit drop as
  with joined as (
    select m.bill_id, f.client_key, f.filing_year,
      public.lobbying_quarter_index(f.filing_year, f.filing_period) as quarter
    from public.lobbying_bill_mentions m
    join public.lobbying_filings f using (filing_uuid)
    where f.is_current
  )
  select bill_id, filing_year, count(distinct client_key)::int as clients, count(*)::int as reports,
    max(quarter) as last_quarter
  from joined
  group by bill_id, filing_year
  union all
  select bill_id, 0, count(distinct client_key)::int, count(*)::int, max(quarter)
  from joined
  group by bill_id;

  delete from public.lobbying_bill_stats s
  where not exists (select 1 from tmp_bill_stats t where t.bill_id = s.bill_id and t.filing_year = s.filing_year);

  insert into public.lobbying_bill_stats (bill_id, filing_year, clients, reports, last_quarter)
  select * from tmp_bill_stats
  on conflict (bill_id, filing_year) do update
    set clients = excluded.clients, reports = excluded.reports, last_quarter = excluded.last_quarter;

  get diagnostics written = row_count;
  return written;
end;
$$;

revoke execute on function public.lobbying_refresh_bill_stats() from public, anon, authenticated;
grant execute on function public.lobbying_refresh_bill_stats() to service_role;

create index if not exists lobbying_filings_in_house_idx
  on public.lobbying_filings (client_key, filing_year, filing_period)
  where is_current and is_in_house;

create or replace view public.lobbying_counted with (security_invoker = true) as
select f.*
from public.lobbying_filings f
left join (
  select distinct client_key, filing_year, filing_period
  from public.lobbying_filings
  where is_current and is_in_house
) self_filed
  on self_filed.client_key = f.client_key
 and self_filed.filing_year = f.filing_year
 and self_filed.filing_period = f.filing_period
where f.is_current
  and (f.is_in_house or self_filed.client_key is null);

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
  with scoped as (
    select s.bill_id, s.clients, s.reports, s.last_quarter
    from public.lobbying_bill_stats s
    where s.filing_year = case when array_length(p_years, 1) = 1 then p_years[1] else 0 end
      and (p_sponsor is null or s.bill_id in (select b.id from public.bills b where b.sponsor_id = p_sponsor))
      and (p_issue is null or s.bill_id in (select l.bill_id from public.issue_bill_links l where l.issue_id = p_issue))
    order by s.clients desc, s.reports desc, s.bill_id
    limit greatest(1, least(p_limit, 200))
  )
  select s.bill_id, b.number, b.title, b.status, b.sponsor_name, s.clients::bigint, s.reports::bigint, s.last_quarter
  from scoped s
  join public.bills b on b.id = s.bill_id
  order by s.clients desc, s.reports desc, s.bill_id;
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
  with ranked as (
    select c.client_key, sum(coalesce(c.amount, 0)) as spend
    from public.lobbying_counted c
    where c.filing_year = p_year
      and (p_search is null or c.client_key like '%' || p_search || '%')
    group by c.client_key
    order by 2 desc, 1
    limit greatest(1, least(p_limit, 200))
  ),
  described as (
    select
      f.client_key,
      max(f.client_name) as client_name,
      count(distinct f.registrant_id) filter (where not f.is_in_house) as firms,
      count(*) as reports,
      bool_or(f.is_in_house) as in_house
    from public.lobbying_filings f
    where f.is_current and f.filing_year = p_year
      and f.client_key in (select client_key from ranked)
    group by f.client_key
  ),
  bills as (
    select f.client_key, count(distinct m.bill_id) as bills
    from public.lobbying_filings f
    join public.lobbying_bill_mentions m using (filing_uuid)
    where f.is_current and f.filing_year = p_year
      and f.client_key in (select client_key from ranked)
    group by f.client_key
  )
  select r.client_key, d.client_name, r.spend, coalesce(d.firms, 0), coalesce(d.reports, 0), coalesce(b.bills, 0), coalesce(d.in_house, false)
  from ranked r
  left join described d using (client_key)
  left join bills b using (client_key)
  order by r.spend desc, r.client_key;
$$;

create or replace function public.lobbying_client_index(p_years integer[], p_limit integer default 1000)
returns table (client_key text, client_name text, spend numeric, firms bigint, bills bigint)
language sql
stable
set search_path = public, pg_temp
as $$
  with ranked as (
    select c.client_key, sum(coalesce(c.amount, 0)) as spend
    from public.lobbying_counted c
    where c.filing_year = any(p_years)
    group by c.client_key
    order by 2 desc, 1
    limit greatest(1, least(p_limit, 10000))
  ),
  described as (
    select
      f.client_key,
      max(f.client_name) as client_name,
      count(distinct f.registrant_id) filter (where not f.is_in_house) as firms
    from public.lobbying_filings f
    where f.is_current and f.filing_year = any(p_years)
      and f.client_key in (select client_key from ranked)
    group by f.client_key
  ),
  bills as (
    select f.client_key, count(distinct m.bill_id) as bills
    from public.lobbying_filings f
    join public.lobbying_bill_mentions m using (filing_uuid)
    where f.is_current and f.filing_year = any(p_years)
      and f.client_key in (select client_key from ranked)
    group by f.client_key
  )
  select r.client_key, d.client_name, r.spend, coalesce(d.firms, 0), coalesce(b.bills, 0)
  from ranked r
  left join described d using (client_key)
  left join bills b using (client_key)
  order by r.spend desc, r.client_key;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'lobbying_refresh_bill_stats()',
    'lobbying_top_bills(integer[], integer, text, text)',
    'lobbying_top_clients(integer, integer, text)',
    'lobbying_client_index(integer[], integer)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;
