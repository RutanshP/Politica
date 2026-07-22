-- The bills directory rail shows an Overview panel (total / by status) and a Top topics panel
-- (topic counts as meters). Both are aggregates over the whole federal bill set, which the UI
-- had no way to get: `bill_directory_facets` returned distinct values only, and the page itself
-- only ever holds the 20 rows of the current page.
--
-- Rather than add a second RPC and a second round trip, this widens the existing one with a
-- total column. Additive for callers -- the dropdown consumers select facet/value and ignore
-- the extra column -- but adding an OUT parameter changes the function's return type, so the
-- old signature has to be dropped rather than replaced.
--
-- The column is `total`, not `count`: an OUT parameter named `count` shadows the aggregate of
-- the same name inside the function body.
drop function if exists public.bill_directory_facets(text);

create function public.bill_directory_facets(p_session text)
returns table (facet text, value text, total bigint)
language sql
stable
as $$
  with scoped as (
    select *
    from public.bills
    where sponsor_id <> 'federal-vote-pending'
      and jurisdiction_type = 'federal'
      and session = p_session
  )
  select 'chamber'::text,   chamber,        count(*) from scoped where chamber        is not null and chamber        <> '' group by 1, 2
  union all
  select 'status'::text,    status,         count(*) from scoped where status         is not null and status         <> '' group by 1, 2
  union all
  select 'session'::text,   session,        count(*) from scoped where session        is not null and session        <> '' group by 1, 2
  union all
  select 'topic'::text,     topic,          count(*) from scoped where topic          is not null and topic          <> '' group by 1, 2
  union all
  select 'sponsor'::text,   sponsor_name,   count(*) from scoped where sponsor_name   is not null and sponsor_name   <> '' group by 1, 2
  union all
  select 'committee'::text, committee_name, count(*) from scoped where committee_name is not null and committee_name <> '' group by 1, 2
  order by 1, 2;
$$;
