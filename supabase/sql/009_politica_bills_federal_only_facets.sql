-- The bills directory is federal-only: state legislation is never synced (the OpenStates cron
-- only pulls state legislators and votes, not bills -- see scripts/sync-states.sh), so the
-- directory's old "Level" (Federal/State) and "State" filters had no real data behind the State
-- option. The UI has dropped both filters; this drops the matching facets so the RPC stops doing
-- unnecessary work and can't reintroduce them if state bill rows ever get created by mistake.
create or replace function public.bill_directory_facets(p_session text)
returns table (facet text, value text)
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
