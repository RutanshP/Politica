-- Lobbying client rankings read from a rollup, not computed per request. Already applied.
--
-- lobbying_client_index took 566ms warm but several seconds cold, and the weekly search rebuild on
-- Vercel timed out on it twice -- shipping a search index with no lobbying organizations both
-- times, silently (the failure is now recorded in the run metadata too). lobbying_top_clients had
-- the same shape. Both read a rollup the sync refreshes now, so a cold cache cannot change the
-- outcome: the index read is 41ms, an index scan rather than an aggregation over 150k reports.
--
-- filing_year 0 is the whole Congress. Spend sums across years; organizations, firms and bills do
-- not, so those take the per-year maximum.

create table if not exists public.lobbying_client_stats (
  client_key text not null,
  filing_year integer not null,
  client_name text not null,
  spend numeric not null,
  firms integer not null,
  reports integer not null,
  bills integer not null,
  in_house boolean not null,
  primary key (client_key, filing_year)
);
create index if not exists lobbying_client_stats_rank_idx on public.lobbying_client_stats (filing_year, spend desc, client_key);
alter table public.lobbying_client_stats enable row level security;
revoke all on public.lobbying_client_stats from anon, authenticated;
grant select, insert, update, delete on public.lobbying_client_stats to service_role;

create or replace function public.lobbying_refresh_client_stats()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  written integer;
begin
  create temporary table tmp_client_stats on commit drop as
  with spend as (
    select client_key, filing_year, sum(coalesce(amount, 0)) as spend
    from public.lobbying_counted
    group by client_key, filing_year
  ),
  described as (
    select
      f.client_key,
      f.filing_year,
      max(f.client_name) as client_name,
      count(distinct f.registrant_id) filter (where not f.is_in_house) as firms,
      count(*) as reports,
      bool_or(f.is_in_house) as in_house
    from public.lobbying_filings f
    where f.is_current and f.client_key is not null and f.client_key <> ''
    group by f.client_key, f.filing_year
  ),
  bills as (
    select f.client_key, f.filing_year, count(distinct m.bill_id) as bills
    from public.lobbying_filings f
    join public.lobbying_bill_mentions m using (filing_uuid)
    where f.is_current
    group by f.client_key, f.filing_year
  ),
  per_year as (
    select
      d.client_key,
      d.filing_year,
      d.client_name,
      coalesce(s.spend, 0) as spend,
      d.firms::int as firms,
      d.reports::int as reports,
      coalesce(b.bills, 0)::int as bills,
      d.in_house
    from described d
    left join spend s on s.client_key = d.client_key and s.filing_year = d.filing_year
    left join bills b on b.client_key = d.client_key and b.filing_year = d.filing_year
  )
  select client_key, filing_year, client_name, spend, firms, reports, bills, in_house from per_year
  union all
  select
    p.client_key,
    0,
    max(p.client_name),
    sum(p.spend),
    max(p.firms),
    sum(p.reports)::int,
    max(p.bills),
    bool_or(p.in_house)
  from per_year p
  group by p.client_key;

  delete from public.lobbying_client_stats s
  where not exists (
    select 1 from tmp_client_stats t where t.client_key = s.client_key and t.filing_year = s.filing_year
  );

  insert into public.lobbying_client_stats (client_key, filing_year, client_name, spend, firms, reports, bills, in_house)
  select * from tmp_client_stats
  on conflict (client_key, filing_year) do update
    set client_name = excluded.client_name,
        spend = excluded.spend,
        firms = excluded.firms,
        reports = excluded.reports,
        bills = excluded.bills,
        in_house = excluded.in_house;

  get diagnostics written = row_count;
  return written;
end;
$$;

create or replace function public.lobbying_client_index(p_years integer[], p_limit integer default 1000)
returns table (client_key text, client_name text, spend numeric, firms bigint, bills bigint)
language sql
stable
set search_path = public, pg_temp
as $$
  select s.client_key, s.client_name, s.spend, s.firms::bigint, s.bills::bigint
  from public.lobbying_client_stats s
  where s.filing_year = case when array_length(p_years, 1) = 1 then p_years[1] else 0 end
  order by s.spend desc, s.client_key
  limit greatest(1, least(p_limit, 10000));
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
  select s.client_key, s.client_name, s.spend, s.firms::bigint, s.reports::bigint, s.bills::bigint, s.in_house
  from public.lobbying_client_stats s
  where s.filing_year = p_year
    and (p_search is null or s.client_key like '%' || p_search || '%')
  order by s.spend desc, s.client_key
  limit greatest(1, least(p_limit, 200));
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'lobbying_refresh_client_stats()',
    'lobbying_client_index(integer[], integer)',
    'lobbying_top_clients(integer, integer, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;
