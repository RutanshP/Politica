-- Lobbying organizations in global search: one row per client this Congress, biggest spenders
-- first, for rebuildSearchIndexFromStoredData. Capped because the long tail -- thousands of
-- clients that reported under $5,000 in total -- is not what anyone searches for, and each row is
-- a search_documents row. Already applied.
create or replace function public.lobbying_client_index(p_years integer[], p_limit integer default 4000)
returns table (client_key text, client_name text, spend numeric, firms bigint, bills bigint)
language sql
stable
set search_path = public, pg_temp
as $$
  with spend as (
    select client_key, sum(coalesce(amount, 0)) as spend
    from public.lobbying_counted
    where filing_year = any(p_years)
    group by client_key
  ),
  clients as (
    select
      f.client_key,
      max(f.client_name) as client_name,
      count(distinct f.registrant_id) filter (where not f.is_in_house) as firms,
      count(distinct m.bill_id) as bills
    from public.lobbying_filings f
    left join public.lobbying_bill_mentions m using (filing_uuid)
    where f.is_current and f.filing_year = any(p_years) and f.client_key is not null and f.client_key <> ''
    group by f.client_key
  )
  select c.client_key, c.client_name, coalesce(s.spend, 0), c.firms, c.bills
  from clients c
  left join spend s using (client_key)
  order by coalesce(s.spend, 0) desc, c.client_key
  limit greatest(1, least(p_limit, 10000));
$$;

revoke execute on function public.lobbying_client_index(integer[], integer) from public, anon, authenticated;
grant execute on function public.lobbying_client_index(integer[], integer) to service_role;
